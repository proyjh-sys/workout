// ④ 설정 탭 + 운동 목록 관리
import { html, useState, useRef } from '../vendor/preact-htm.mjs';
import { db, useLive, exerciseUsage, addExercise, updateExercise } from '../db.js';
import { go, toast, confirmDialog, openSheet, closeSheet } from '../ui.js';
import { TopBar, Stepper } from '../components.js';
import { PartTabs, sortExercises } from './exercisePicker.js';
import { exportBackup, exportCSV, inspectBackup, restoreBackup, useBackupStatus } from '../backup.js';
import { PARTS, fmtNum } from '../util.js';
import { APP_VERSION } from '../version.js';

export function SettingsView() {
  const backup = useBackupStatus();
  const fileRef = useRef();
  const persisted = useLive(async () => (navigator.storage?.persisted ? navigator.storage.persisted() : null), []);

  const doBackup = async () => {
    const ok = await exportBackup();
    if (ok) toast('백업 파일을 만들었어요. 파일 앱에 저장했는지 확인하세요');
  };

  const onFile = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const info = inspectBackup(await f.text());
      const when = info.exportedAt ? new Date(info.exportedAt).toLocaleString('ko-KR') : '알 수 없음';
      const ok = await confirmDialog({
        title: '백업에서 복원할까요?',
        message: `백업 시각: ${when}\n운동 기록 ${info.workouts}건\n\n⚠️ 지금 앱에 있는 기록은 모두 이 백업 내용으로 바뀌어요.`,
        okText: '복원', danger: true,
      });
      if (!ok) return;
      await restoreBackup(info.obj);
      toast('복원을 마쳤어요');
    } catch (err) {
      confirmDialog({ title: '복원할 수 없어요', message: err.message, okText: '확인', cancelText: '닫기' });
    }
  };

  const lastText = backup?.lastAt
    ? `마지막 백업: ${new Date(backup.lastAt).toLocaleDateString('ko-KR')} (${backup.days === 0 ? '오늘' : backup.days + '일 전'})`
    : '아직 백업한 적이 없어요';

  return html`
    <div class="page">
      <h1 class="page-title">설정</h1>

      <h2 class="section-title">운동</h2>
      <div class="card list">
        <button class="list-item" onClick=${() => go({ name: 'exercises' })}>
          <span>운동 목록 관리</span><span class="chev">›</span>
        </button>
        <div class="list-item disabled"><span>루틴 템플릿</span><span class="muted small">2단계에서 추가</span></div>
        <div class="list-item disabled"><span>휴식 타이머</span><span class="muted small">2단계에서 추가</span></div>
        <div class="list-item disabled"><span>주간 목표</span><span class="muted small">3단계에서 추가</span></div>
      </div>

      <h2 class="section-title">데이터 보호</h2>
      <div class="card">
        <div class=${'backup-status ' + (backup?.needReminder ? 'warn' : '')}>${lastText}</div>
        <button class="big-btn primary" onClick=${doBackup}>💾 백업 파일 저장 (JSON)</button>
        <p class="hint">공유 메뉴가 뜨면 <b>'파일에 저장'</b> → iCloud Drive를 고르세요.</p>
        <div class="btn-row">
          <button class="btn grow" onClick=${() => fileRef.current.click()}>백업에서 복원</button>
          <button class="btn grow" onClick=${exportCSV}>CSV 내보내기</button>
        </div>
        <input ref=${fileRef} type="file" accept="application/json,.json" style="display:none" onChange=${onFile} />
      </div>

      <h2 class="section-title">AI 코치</h2>
      <div class="card list">
        <div class="list-item disabled"><span>AI 분석용 내보내기</span><span class="muted small">3단계에서 추가</span></div>
      </div>

      <h2 class="section-title">앱 정보</h2>
      <div class="card list">
        <div class="list-item"><span>버전</span><span class="muted">${APP_VERSION}</span></div>
        <div class="list-item"><span>저장 공간 보호</span>
          <span class="muted small">${persisted === true ? '켜짐 ✓' : persisted === false ? '홈 화면 앱으로 쓰면 더 안전해요' : '-'}</span></div>
      </div>
      <p class="hint center">모든 기록은 이 아이폰 안에만 저장돼요.</p>
    </div>`;
}

/* ---------- 운동 목록 관리 ---------- */
export function ExercisesView() {
  const [part, setPart] = useState('chest');
  const [showHidden, setShowHidden] = useState(false);
  const data = useLive(async () => {
    const usage = await exerciseUsage();
    const list = await db.exercises.where('part').equals(part).toArray();
    return { list: sortExercises(list, usage), usage };
  }, [part]);

  const visible = data?.list.filter((e) => !e.archived) ?? [];
  const hidden = data?.list.filter((e) => e.archived) ?? [];

  const edit = (ex) => openSheet(() => html`<${ExerciseEditor} ex=${ex} part=${part} key=${ex?.id || 'new'} />`);

  return html`
    <div class="page has-topbar">
      <${TopBar} title="운동 목록" />
      <${PartTabs} value=${part} onChange=${setPart} />
      <div class="card list">
        ${visible.map((ex) => html`
          <button class="list-item" key=${ex.id} onClick=${() => edit(ex)}>
            <span>${ex.favorite ? '★ ' : ''}${ex.name}</span>
            <span class="muted small">증량 ${fmtNum(ex.incrementKg)}kg${data.usage[ex.id] ? ` · ${data.usage[ex.id]}회` : ''} ›</span>
          </button>`)}
      </div>
      <button class="big-btn secondary" onClick=${() => edit(null)}>+ 새 운동 추가</button>
      ${hidden.length > 0 && html`
        <button class="fold-btn" onClick=${() => setShowHidden(!showHidden)}>${showHidden ? '▾' : '▸'} 숨긴 운동 ${hidden.length}개</button>
        ${showHidden && html`
          <div class="card list">
            ${hidden.map((ex) => html`
              <button class="list-item" key=${ex.id} onClick=${() => edit(ex)}>
                <span class="muted">${ex.name}</span><span class="muted small">숨김 ›</span>
              </button>`)}
          </div>`}`}
    </div>`;
}

function ExerciseEditor({ ex, part }) {
  const [f, setF] = useState({
    name: ex?.name ?? '',
    part: ex?.part ?? part,
    incrementKg: ex?.incrementKg ?? 2.5,
    repUnit: ex?.repUnit ?? 'reps',
    favorite: ex?.favorite ?? false,
  });
  const up = (p) => setF({ ...f, ...p });

  const save = async () => {
    const name = f.name.trim();
    if (!name) return toast('이름을 입력하세요');
    if (ex) await updateExercise(ex.id, { ...f, name });
    else await addExercise({ ...f, name }).then((n) => f.favorite && updateExercise(n.id, { favorite: true }));
    closeSheet();
    toast('저장했어요');
  };

  const toggleHide = async () => {
    if (!ex.archived) {
      const ok = await confirmDialog({
        title: `'${ex.name}' 숨기기`,
        message: '운동 선택 목록에서 사라져요. 지난 기록은 그대로 남아요.',
        okText: '숨기기',
      });
      if (!ok) return;
    }
    await updateExercise(ex.id, { archived: !ex.archived });
    closeSheet();
    toast(ex.archived ? '다시 보이게 했어요' : '숨겼어요');
  };

  return html`
    <div class="editor">
      <div class="sheet-title">${ex ? '운동 수정' : '새 운동'}</div>
      <div class="field-label">이름</div>
      <input class="text-input full" value=${f.name} placeholder="예: 스미스 머신 스쿼트" onInput=${(e) => up({ name: e.target.value })} />
      <div class="field-label">부위</div>
      <div class="choice-grid three">
        ${PARTS.map((p) => html`<button class=${'choice ' + (f.part === p.id ? 'on' : '')} onClick=${() => up({ part: p.id })}>${p.label}</button>`)}
      </div>
      <div class="field-label">증량 폭 (다음 단계의 증량 제안·무게 버튼 간격)</div>
      <${Stepper} label="증량 폭" value=${f.incrementKg} step=${0.5} min=${0.5} unit="kg" display=${(v) => `${fmtNum(v)}kg`}
        onChange=${(v) => up({ incrementKg: Math.max(0.5, v) })} />
      <div class="field-label">기록 방식</div>
      <div class="choice-grid">
        <button class=${'choice ' + (f.repUnit === 'reps' ? 'on' : '')} onClick=${() => up({ repUnit: 'reps' })}>횟수(회)</button>
        <button class=${'choice ' + (f.repUnit === 'sec' ? 'on' : '')} onClick=${() => up({ repUnit: 'sec' })}>시간(초)</button>
      </div>
      <button class=${'choice full fav ' + (f.favorite ? 'on' : '')} onClick=${() => up({ favorite: !f.favorite })}>
        ${f.favorite ? '★ 즐겨찾기 (맨 위에 표시)' : '☆ 즐겨찾기에 추가'}
      </button>
      <button class="big-btn primary" onClick=${save}>저장</button>
      ${ex && html`<button class="btn ghost full" onClick=${toggleHide}>${ex.archived ? '다시 보이기' : '목록에서 숨기기'}</button>`}
    </div>`;
}

// 유산소 운동 기록 화면
import { html, useState, useEffect } from '../vendor/preact-htm.mjs';
import { db, saveCardio, deleteWorkout } from '../db.js';
import { back, toast, confirmDialog, useWakeLock } from '../ui.js';
import { Stepper, TopBar } from '../components.js';
import { CARDIO_KINDS, INTENSITY, fmtDate, todayStr, vibrate } from '../util.js';

const num = (v) => {
  if (v === '' || v == null) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

export function CardioView({ workoutId, date = todayStr() }) {
  useWakeLock();
  const [form, setForm] = useState(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    (async () => {
      if (workoutId) {
        const c = await db.cardio.where('workoutId').equals(workoutId).first();
        setForm({
          kind: c.kind, durationMin: c.durationMin, rpe: c.rpe,
          distanceKm: c.distanceKm ?? '', avgHr: c.avgHr ?? '', kcal: c.kcal ?? '', note: c.note ?? '',
        });
        setMore(!!(c.distanceKm || c.avgHr || c.kcal || c.note));
      } else {
        // 새 기록: 지난번 유산소 종류·시간을 기본값으로
        const last = (await db.cardio.orderBy('date').reverse().first()) || {};
        setForm({ kind: last.kind || 'walk', durationMin: last.durationMin || 30, rpe: null, distanceKm: '', avgHr: '', kcal: '', note: '' });
      }
    })();
  }, [workoutId]);

  if (!form) return html`<div class="page"></div>`;
  const up = (patch) => setForm({ ...form, ...patch });

  const save = async () => {
    vibrate();
    await saveCardio({
      workoutId, date,
      data: {
        kind: form.kind,
        durationMin: form.durationMin,
        rpe: form.rpe,
        distanceKm: num(form.distanceKm),
        avgHr: num(form.avgHr),
        kcal: num(form.kcal),
        note: form.note.trim(),
      },
    });
    toast(workoutId ? '수정했어요' : '유산소 기록을 저장했어요 🏃');
    back();
  };

  const remove = async () => {
    const ok = await confirmDialog({ title: '이 유산소 기록을 삭제할까요?', okText: '삭제', danger: true });
    if (!ok) return;
    await deleteWorkout(workoutId);
    toast('삭제했어요');
    back();
  };

  return html`
    <div class="page has-topbar">
      <${TopBar} title=${workoutId ? '유산소 수정' : '유산소 기록'} sub=${date === todayStr() ? '오늘' : fmtDate(date)} backLabel="‹ 취소" />

      <section class="card">
        <div class="field-label">종류</div>
        <div class="choice-grid">
          ${CARDIO_KINDS.map((k) => html`
            <button class=${'choice ' + (form.kind === k.id ? 'on' : '')} onClick=${() => up({ kind: k.id })}>${k.label}</button>`)}
        </div>

        <div class="field-label">시간</div>
        <${Stepper} label="시간" value=${form.durationMin} step=${5} unit="분" decimal=${false}
          display=${(v) => `${v}분`} onChange=${(v) => up({ durationMin: Math.round(v) })} />

        <div class="field-label">강도</div>
        <div class="intensity">
          ${INTENSITY.map((it) => html`
            <button class=${'int-btn ' + (form.rpe === it.rpe ? 'on' : '')} onClick=${() => up({ rpe: form.rpe === it.rpe ? null : it.rpe })}>
              <span>${it.label}</span><span class="int-rpe">RPE ${it.rpe}</span>
            </button>`)}
        </div>
      </section>

      <section class="card">
        <button class="fold-btn" onClick=${() => setMore(!more)}>${more ? '▾' : '▸'} 거리·심박·칼로리·메모 (선택)</button>
        ${more && html`
          <div class="opt-grid">
            <label class="opt"><span>거리</span>
              <input class="text-input" inputmode="decimal" placeholder="-" value=${form.distanceKm} onInput=${(e) => up({ distanceKm: e.target.value })} /><em>km</em></label>
            <label class="opt"><span>평균 심박수</span>
              <input class="text-input" inputmode="numeric" placeholder="-" value=${form.avgHr} onInput=${(e) => up({ avgHr: e.target.value })} /><em>bpm</em></label>
            <label class="opt"><span>칼로리</span>
              <input class="text-input" inputmode="numeric" placeholder="-" value=${form.kcal} onInput=${(e) => up({ kcal: e.target.value })} /><em>kcal</em></label>
          </div>
          <textarea class="note-input" rows="2" placeholder="메모" value=${form.note} onInput=${(e) => up({ note: e.target.value })}></textarea>`}
      </section>

      <button class="big-btn primary" onClick=${save}>${workoutId ? '수정 저장' : '저장'}</button>
      ${workoutId && html`<button class="btn danger-ghost full" onClick=${remove}>이 기록 삭제</button>`}
    </div>`;
}

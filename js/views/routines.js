// 루틴 템플릿: 만들기·수정, 운동 화면에서 불러오기, 운동 기록을 루틴으로 저장
import { html, useState, useEffect } from '../vendor/preact-htm.mjs';
import { db, useLive, useExercises, addEntry, touchWorkout } from '../db.js';
import { go, back, toast, confirmDialog, openSheet, closeSheet, textPrompt } from '../ui.js';
import { TopBar, Stepper } from '../components.js';
import { ExercisePicker } from './exercisePicker.js';
import { mode } from '../progress.js';
import { uuid, nowIso, partLabel } from '../util.js';

export function useRoutines() {
  return useLive(async () => {
    const list = await db.routines.toArray();
    return list.sort((a, b) => (b.lastUsedAt || b.createdAt).localeCompare(a.lastUsedAt || a.createdAt));
  }, [], []);
}

function routineSummary(r, exMap) {
  return r.items.map((it) => `${exMap[it.exerciseId]?.name ?? '?'} ${it.targetSets}×${it.targetReps}`).join(' · ');
}

/** 운동 화면에 루틴의 운동들을 한꺼번에 추가 */
export async function loadRoutine(workout, routine) {
  for (const it of routine.items) {
    const ex = await db.exercises.get(it.exerciseId);
    if (!ex) continue;
    await addEntry(workout, ex, { targetSets: it.targetSets, targetReps: it.targetReps, routineId: routine.id });
  }
  await db.routines.update(routine.id, { lastUsedAt: nowIso() });
  await touchWorkout(workout.id, { routineId: routine.id, routineName: routine.name });
  toast(`'${routine.name}' 루틴을 불러왔어요`);
}

/** 운동 화면에서 여는 '루틴 불러오기' 시트 */
export function RoutinePickerSheet({ workout }) {
  const routines = useRoutines();
  const exMap = useExercises();
  return html`
    <div>
      <div class="sheet-title">루틴 불러오기</div>
      ${routines.length === 0 && html`
        <div class="empty">저장된 루틴이 없어요.<br/>설정 → 루틴 템플릿에서 만들거나,<br/>운동을 마친 뒤 '루틴으로 저장'을 눌러 보세요.</div>`}
      <div class="picker-list">
        ${routines.map((r) => html`
          <button class="picker-item routine-item" key=${r.id} onClick=${() => { closeSheet(); loadRoutine(workout, r); }}>
            <span class="picker-name">${r.name}</span>
            <span class="picker-sub">${routineSummary(r, exMap)}</span>
          </button>`)}
      </div>
    </div>`;
}

/** 운동 기록 → 새 루틴으로 저장 */
export async function saveWorkoutAsRoutine(workoutId) {
  const entries = (await db.entries.where('workoutId').equals(workoutId).toArray()).sort((a, b) => a.order - b.order);
  const sets = (await db.sets.where('workoutId').equals(workoutId).toArray()).filter((s) => s.done);
  const items = entries
    .map((e) => {
      const ss = sets.filter((s) => s.entryId === e.id);
      if (!ss.length) return null;
      return { exerciseId: e.exerciseId, targetSets: ss.length, targetReps: mode(ss.map((s) => s.reps)) };
    })
    .filter(Boolean);
  if (!items.length) return toast('완료한 세트가 있어야 루틴으로 저장할 수 있어요');

  const exs = await db.exercises.bulkGet(items.map((i) => i.exerciseId));
  const parts = [...new Set(exs.filter(Boolean).map((e) => partLabel(e.part)))];
  const name = await textPrompt({ title: '새 루틴 이름', value: `${parts.join('·')} 데이` });
  if (!name) return;
  const t = nowIso();
  await db.routines.add({ id: uuid(), name, items, createdAt: t, updatedAt: t, lastUsedAt: null });
  toast(`'${name}' 루틴으로 저장했어요`);
}

/* ---------- 설정 → 루틴 목록 ---------- */
export function RoutinesView() {
  const routines = useRoutines();
  const exMap = useExercises();
  return html`
    <div class="page has-topbar">
      <${TopBar} title="루틴 템플릿" />
      ${routines.length === 0 && html`<div class="empty">아직 루틴이 없어요.<br/>'가슴·삼두 데이'처럼 자주 하는 운동 묶음을 만들어 두세요.</div>`}
      ${routines.map((r) => html`
        <button class="card routine-card" key=${r.id} onClick=${() => go({ name: 'routine', id: r.id })}>
          <div class="entry-name">${r.name}</div>
          <div class="muted small">${routineSummary(r, exMap)}</div>
        </button>`)}
      <button class="big-btn secondary" onClick=${() => go({ name: 'routine', id: null })}>+ 새 루틴 만들기</button>
    </div>`;
}

/* ---------- 루틴 편집 ---------- */
export function RoutineEditor({ id }) {
  const exMap = useExercises();
  const [r, setR] = useState(null);

  useEffect(() => {
    (async () => {
      const found = id ? await db.routines.get(id) : null;
      setR(found ? structuredClone(found) : { id: null, name: '', items: [] });
    })();
  }, [id]);
  if (!r) return html`<div class="page"></div>`;

  const setItem = (i, patch) => setR({ ...r, items: r.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  const move = (i, d) => {
    const items = [...r.items];
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    setR({ ...r, items });
  };
  const remove = (i) => setR({ ...r, items: r.items.filter((_, j) => j !== i) });
  const addEx = () => openSheet(() => html`<${ExercisePicker}
    initialPart=${exMap[r.items[r.items.length - 1]?.exerciseId]?.part || 'chest'}
    alreadyIds=${r.items.map((i) => i.exerciseId)}
    onPick=${(ex) => setR((cur) => ({ ...cur, items: [...cur.items, { exerciseId: ex.id, targetSets: 3, targetReps: ex.repUnit === 'sec' ? 30 : 10 }] }))} />`);

  const save = async () => {
    const name = r.name.trim();
    if (!name) return toast('루틴 이름을 입력하세요');
    if (!r.items.length) return toast('운동을 하나 이상 추가하세요');
    const t = nowIso();
    if (r.id) await db.routines.put({ ...r, name, updatedAt: t });
    else await db.routines.add({ ...r, id: uuid(), name, createdAt: t, updatedAt: t, lastUsedAt: null });
    toast('루틴을 저장했어요');
    back();
  };
  const del = async () => {
    const ok = await confirmDialog({ title: `'${r.name}' 루틴 삭제`, message: '지난 운동 기록은 지워지지 않아요.', okText: '삭제', danger: true });
    if (!ok) return;
    await db.routines.delete(r.id);
    toast('삭제했어요');
    back();
  };

  return html`
    <div class="page has-topbar">
      <${TopBar} title=${r.id ? '루틴 수정' : '새 루틴'} backLabel="‹ 취소" />
      <div class="card">
        <div class="field-label">루틴 이름</div>
        <input class="text-input full" placeholder="예: 가슴·삼두 데이" value=${r.name} onInput=${(e) => setR({ ...r, name: e.target.value })} />
      </div>

      ${r.items.map((it, i) => {
        const ex = exMap[it.exerciseId];
        const sec = ex?.repUnit === 'sec';
        return html`
          <div class="card routine-row" key=${it.exerciseId + i}>
            <div class="entry-head">
              <div>
                <div class="entry-name">${i + 1}. ${ex?.name ?? '(삭제된 운동)'}</div>
                <div class="muted small">${ex ? partLabel(ex.part) : ''}</div>
              </div>
              <div class="row-tools">
                <button class="icon-btn" aria-label="위로" onClick=${() => move(i, -1)}>↑</button>
                <button class="icon-btn" aria-label="아래로" onClick=${() => move(i, 1)}>↓</button>
                <button class="icon-btn" aria-label="빼기" onClick=${() => remove(i)}>🗑</button>
              </div>
            </div>
            <div class="two-col">
              <div>
                <div class="field-label">목표 세트</div>
                <${Stepper} label="목표 세트" value=${it.targetSets} step=${1} min=${1} decimal=${false} display=${(v) => `${v}세트`}
                  onChange=${(v) => setItem(i, { targetSets: Math.max(1, Math.round(v)) })} />
              </div>
              <div>
                <div class="field-label">목표 ${sec ? '시간' : '횟수'}</div>
                <${Stepper} label="목표 횟수" value=${it.targetReps} step=${sec ? 5 : 1} min=${1} decimal=${false} display=${(v) => `${v}${sec ? '초' : '회'}`}
                  onChange=${(v) => setItem(i, { targetReps: Math.max(1, Math.round(v)) })} />
              </div>
            </div>
          </div>`;
      })}

      <button class="big-btn secondary" onClick=${addEx}>+ 운동 추가</button>
      <button class="big-btn primary" onClick=${save}>루틴 저장</button>
      ${r.id && html`<button class="btn danger-ghost full" onClick=${del}>이 루틴 삭제</button>`}
    </div>`;
}

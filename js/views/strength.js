// 근력 운동 기록 화면
import { html, useState } from '../vendor/preact-htm.mjs';
import {
  db, useLive, useExercises, addEntry, addSet, updateSet, deleteSet, updateEntry, deleteEntry,
  getLastPerformance, touchWorkout, deleteWorkout, getSetting,
} from '../db.js';
import { back, openSheet, confirmDialog, toast, useWakeLock } from '../ui.js';
import { Stepper, TopBar, repUnitLabel } from '../components.js';
import { ExercisePicker } from './exercisePicker.js';
import { RoutinePickerSheet, saveWorkoutAsRoutine } from './routines.js';
import { RestBar, startRest, unlockAudio } from '../timer.js';
import { progressionFor, checkPR } from '../progress.js';
import { INTENSITY, fmtDate, fmtShort, fmtWeight, fmtNum, rpeLabel, partLabel, nowIso, vibrate, todayStr } from '../util.js';

export function StrengthView({ workoutId }) {
  useWakeLock();
  const exMap = useExercises();
  const data = useLive(async () => {
    const workout = await db.workouts.get(workoutId);
    if (!workout) return { workout: null };
    const entries = (await db.entries.where('workoutId').equals(workoutId).toArray()).sort((a, b) => a.order - b.order);
    const sets = await db.sets.where('workoutId').equals(workoutId).toArray();
    return { workout, entries, sets };
  }, [workoutId]);

  if (!data) return html`<div class="page"></div>`;
  const { workout, entries, sets } = data;
  if (!workout) return html`<div class="page"><${TopBar} title="근력 운동" /><div class="empty">기록을 찾을 수 없어요</div></div>`;
  const doneCount = sets.filter((s) => s.done).length;

  const close = async () => {
    // 아무 운동도 추가하지 않았다면 빈 기록은 남기지 않음
    if (entries.length === 0) await deleteWorkout(workout.id);
    back();
  };

  const finish = async () => {
    if (doneCount === 0) {
      const ok = await confirmDialog({
        title: '완료한 세트가 없어요',
        message: '이 근력 기록을 삭제할까요?',
        okText: '삭제', cancelText: '계속 운동', danger: true,
      });
      if (!ok) return;
      await deleteWorkout(workout.id);
      return back();
    }
    // 끝내지 않은(완료 안 한) 세트는 정리
    for (const s of sets.filter((s) => !s.done)) await deleteSet(s.id);
    // 세트가 하나도 남지 않은 운동 항목도 정리
    for (const e of entries) if (!sets.some((s) => s.entryId === e.id && s.done)) await deleteEntry(e.id);
    await touchWorkout(workout.id, { endedAt: nowIso() });
    toast(`수고했어요! ${doneCount}세트를 저장했어요 💪`);
    back();
  };

  const lastPart = entries.length ? exMap[entries[entries.length - 1].exerciseId]?.part : undefined;
  const pickExercise = () =>
    openSheet(() => html`<${ExercisePicker}
      initialPart=${lastPart || 'chest'}
      alreadyIds=${entries.map((e) => e.exerciseId)}
      onPick=${(ex) => addEntry(workout, ex)} />`);
  const pickRoutine = () => openSheet(() => html`<${RoutinePickerSheet} workout=${workout} />`);

  return html`
    <div class="page has-topbar with-restbar">
      <${TopBar} title=${workout.routineName || '근력 운동'} sub=${workout.date === todayStr() ? '오늘' : fmtDate(workout.date)}
        onBack=${close} backLabel="‹ 닫기"
        right=${entries.length > 0 && html`<button class="topbar-back" onClick=${pickRoutine}>루틴</button>`} />

      ${entries.length === 0 && html`
        <div class="empty">운동을 추가하거나 루틴을 불러와 시작하세요.<br/>기록은 누를 때마다 자동 저장돼요.</div>
        <button class="big-btn primary" onClick=${pickRoutine}>📋 루틴 불러오기</button>`}

      ${entries.map((e) => html`
        <${EntryCard} key=${e.id} entry=${e} ex=${exMap[e.exerciseId]} workout=${workout}
          sets=${sets.filter((s) => s.entryId === e.id).sort((a, b) => a.order - b.order)} />`)}

      <button class="big-btn secondary add-ex" onClick=${pickExercise}>+ 운동 추가</button>
      ${entries.length > 0 && html`<button class="big-btn primary finish" onClick=${finish}>운동 마치기</button>`}
      ${doneCount > 0 && html`<button class="btn ghost full" onClick=${() => saveWorkoutAsRoutine(workout.id)}>📋 오늘 운동을 새 루틴으로 저장</button>`}
    </div>
    <${RestBar} />`;
}

function EntryCard({ entry, ex, sets, workout }) {
  const [editingId, setEditingId] = useState(null);
  const [showNote, setShowNote] = useState(!!entry.note);
  const last = useLive(() => getLastPerformance(entry.exerciseId, workout.id, workout.date), [entry.exerciseId, workout.id, workout.date]);
  const sugg = useLive(() => progressionFor(entry, ex, workout),
    [entry.id, entry.targetReps, ex?.id, ex?.incrementKg, ex?.targetReps, workout.id]);

  const firstPending = sets.find((s) => !s.done);
  const activeId = editingId ?? firstPending?.id;
  const unit = repUnitLabel(ex);
  const doneN = sets.filter((s) => s.done).length;

  const removeEntry = async () => {
    const ok = await confirmDialog({ title: `${ex?.name ?? '운동'} 삭제`, message: '이 운동의 오늘 세트가 모두 지워져요.', okText: '삭제', danger: true });
    if (ok) deleteEntry(entry.id);
  };

  const plus = async () => {
    vibrate();
    setEditingId(null);
    await addSet(entry, workout);
  };

  const accept = async () => {
    vibrate();
    for (const s of sets.filter((s) => !s.done && s.weightKg < sugg.toKg)) await updateSet(s.id, { weightKg: sugg.toKg });
    await updateEntry(entry.id, { progression: { status: 'accepted', toKg: sugg.toKg } });
  };
  const ignore = () => updateEntry(entry.id, { progression: { status: 'ignored', toKg: sugg.toKg } });
  const showSugg = sugg && !entry.progression && firstPending;

  return html`
    <section class="card entry">
      <div class="entry-head">
        <div>
          <div class="entry-name">${ex?.name ?? '(삭제된 운동)'}</div>
          <div class="entry-last">
            ${last
              ? html`지난번 ${fmtShort(last.date)} · ${last.sets.map((s) => `${fmtWeight(s.weightKg)}×${fmtNum(s.reps)}`).join(', ')}`
              : html`<span class="muted">${ex ? partLabel(ex.part) + ' · ' : ''}첫 기록이에요</span>`}
          </div>
          ${entry.targetSets && html`
            <div class="entry-target">목표 ${entry.targetSets}세트 × ${entry.targetReps}${unit} · <b>${doneN}/${entry.targetSets}</b></div>`}
        </div>
        <button class="icon-btn" aria-label="운동 삭제" onClick=${removeEntry}>🗑</button>
      </div>

      ${showSugg && html`
        <div class="suggest-box">
          <div class="sb-text">💡 지난번 모든 세트 ${sugg.target}${unit} 달성! 오늘 <b>${fmtNum(sugg.toKg)}kg</b> 해볼까요?</div>
          <div class="sb-actions">
            <button class="btn primary small" onClick=${accept}>수락</button>
            <button class="btn small" onClick=${ignore}>무시</button>
          </div>
        </div>`}
      ${entry.progression?.status === 'accepted' && html`<div class="sb-done">⬆ 증량 적용: ${fmtNum(entry.progression.toKg)}kg</div>`}

      <div class="sets">
        ${sets.map((s, i) =>
          s.id === activeId
            ? html`<${SetEditor} key=${s.id} s=${s} index=${i} ex=${ex} onClose=${() => setEditingId(null)} canClose=${s.done} />`
            : html`
              <button key=${s.id} class=${'set-row ' + (s.done ? 'done' : 'pending')} onClick=${() => setEditingId(s.id)}>
                <span class="set-no">${i + 1}</span>
                <span class="set-main">${fmtWeight(s.weightKg)} × ${fmtNum(s.reps)}${unit}</span>
                <span class="set-rpe">${s.done ? (s.rpe ? rpeLabel(s.rpe) : '') + ' ✓' : '대기'}</span>
              </button>`)}
      </div>

      <div class="entry-actions">
        <button class=${'btn ' + (firstPending ? '' : 'primary') + ' grow'} onClick=${plus}>+ 세트 추가</button>
        <button class="btn" onClick=${() => setShowNote(!showNote)}>${entry.note ? '📝 메모' : '메모'}</button>
      </div>
      ${showNote && html`
        <textarea class="note-input" rows="2" placeholder="예: 그립 좁게, 어깨 살짝 불편"
          value=${entry.note} onInput=${(e) => updateEntry(entry.id, { note: e.target.value })}></textarea>`}
    </section>`;
}

function SetEditor({ s, index, ex, onClose, canClose }) {
  const step = ex?.incrementKg || 2.5;
  const isSec = ex?.repUnit === 'sec';

  const complete = async (rpe) => {
    vibrate();
    unlockAudio(); // 휴식 끝 알림음을 위해 지금 소리 사용을 허락받아 둠
    const wasDone = s.done;
    await updateSet(s.id, { rpe, done: true, completedAt: s.completedAt || nowIso() });
    onClose();
    if (!wasDone && (await getSetting('restAuto', true))) startRest(await getSetting('restSec', 90));
    const pr = await checkPR({ ...s, rpe, done: true }, ex);
    if (pr) toast(`🏆 새 개인 최고 기록! ${pr.kind} · ${pr.text}`, { duration: 4500 });
  };
  const remove = async () => {
    await deleteSet(s.id);
    onClose();
  };

  return html`
    <div class="set-editor">
      <div class="se-head">
        <span class="set-no big">${index + 1}세트</span>
        <span class="muted small">${s.done ? '수정 중' : '강도를 누르면 세트 완료'}</span>
      </div>
      <div class="se-steppers">
        <${Stepper} label="무게" value=${s.weightKg} step=${step} unit="kg" display=${fmtWeight}
          onChange=${(v) => updateSet(s.id, { weightKg: v })} />
        <${Stepper} label=${isSec ? '시간' : '횟수'} value=${s.reps} step=${isSec ? 5 : 1} unit=${isSec ? '초' : '회'}
          decimal=${false} display=${(v) => `${fmtNum(v)}${isSec ? '초' : '회'}`}
          onChange=${(v) => updateSet(s.id, { reps: Math.round(v) })} />
      </div>
      <div class="intensity">
        ${INTENSITY.map((it) => html`
          <button class=${'int-btn ' + (s.done && s.rpe === it.rpe ? 'on' : '')} onClick=${() => complete(it.rpe)}>
            <span>${it.label}</span><span class="int-rpe">RPE ${it.rpe}</span>
          </button>`)}
      </div>
      <div class="se-foot">
        <button class="link danger" onClick=${remove}>세트 삭제</button>
        ${canClose && html`<button class="link" onClick=${onClose}>닫기</button>`}
      </div>
    </div>`;
}

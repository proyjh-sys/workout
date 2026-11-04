// ① 오늘 탭
import { html } from '../vendor/preact-htm.mjs';
import { db, useLive, useExercises, createWorkout, lastWorkoutBefore, loadWorkoutDetails } from '../db.js';
import { go, setTab } from '../ui.js';
import { todayStr, fmtDate, daysBetween } from '../util.js';
import { WorkoutSummary } from '../components.js';
import { useBackupStatus } from '../backup.js';

export async function startStrength(date = todayStr()) {
  const existing = (await db.workouts.where('date').equals(date).toArray()).find((w) => w.type === 'strength');
  const w = existing ?? (await createWorkout('strength', date));
  go({ name: 'strength', workoutId: w.id });
}

export function startCardio(date = todayStr()) {
  go({ name: 'cardio', date });
}

export function openWorkout(w) {
  if (w.type === 'strength') go({ name: 'strength', workoutId: w.id });
  else go({ name: 'cardio', workoutId: w.id, date: w.date });
}

export function TodayView() {
  const today = todayStr();
  const exMap = useExercises();
  const data = useLive(async () => {
    const todays = await db.workouts.where('date').equals(today).toArray();
    const last = await lastWorkoutBefore(today);
    return { todays: await loadWorkoutDetails(todays), last };
  }, [today]);
  const backup = useBackupStatus();

  if (!data) return html`<div class="page"></div>`;
  const { todays, last } = data;

  // 마지막 기록과 반대 종류를 제안 (기록이 없으면 근력)
  const suggest = last?.type === 'strength' ? 'cardio' : 'strength';
  const reason = !last
    ? '첫 기록을 시작해 볼까요?'
    : `${daysBetween(last.date, today) === 1 ? '어제' : fmtDate(last.date)} ${last.type === 'strength' ? '근력' : '유산소'} → 오늘은 ${suggest === 'strength' ? '근력' : '유산소'} 차례예요`;

  const doneToday = todays.length > 0;

  const strengthBtn = html`
    <button class=${'big-btn strength ' + (suggest === 'strength' ? 'primary' : 'secondary')} onClick=${() => startStrength()}>
      <span class="big-btn-icon">💪</span><span>근력 ${todays.some((w) => w.type === 'strength') ? '이어서' : '시작'}</span>
    </button>`;
  const cardioBtn = html`
    <button class=${'big-btn cardio ' + (suggest === 'cardio' ? 'primary' : 'secondary')} onClick=${() => startCardio()}>
      <span class="big-btn-icon">🏃</span><span>유산소 기록</span>
    </button>`;

  return html`
    <div class="page">
      <h1 class="page-title">${fmtDate(today)}</h1>

      ${backup?.needReminder && html`
        <div class="banner warn" onClick=${() => setTab('settings')}>
          💾 ${backup.lastAt ? `마지막 백업 후 ${backup.days}일이 지났어요.` : '아직 백업한 적이 없어요.'} 눌러서 백업하기
        </div>`}

      <section class="card suggest">
        <div class="suggest-text">${doneToday ? '오늘도 수고했어요! 추가로 기록할 수 있어요.' : reason}</div>
        <div class="big-btn-row">
          ${suggest === 'strength' ? [strengthBtn, cardioBtn] : [cardioBtn, strengthBtn]}
        </div>
      </section>

      <h2 class="section-title">오늘의 기록</h2>
      ${todays.length === 0 && html`<div class="empty">아직 기록이 없어요</div>`}
      ${todays.map((w) => html`<${WorkoutSummary} key=${w.id} w=${w} exMap=${exMap} onClick=${() => openWorkout(w)} />`)}
    </div>`;
}

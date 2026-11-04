// ② 기록 탭: 달력 + 날짜별 상세
import { html, useState } from '../vendor/preact-htm.mjs';
import { db, useLive, useExercises, loadWorkoutDetails, deleteWorkout, isEmptyWorkout, getSetting } from '../db.js';
import { confirmDialog, toast } from '../ui.js';
import { WorkoutSummary } from '../components.js';
import { startStrength, startCardio, openWorkout } from './today.js';
import { saveWorkoutAsRoutine } from './routines.js';
import { DailyFold } from './today.js';
import { conditionText, bodyText } from './daily.js';
import { rpeLabel } from '../util.js';
import { todayStr, toDateStr, fmtDate } from '../util.js';

const WEEK = ['월', '화', '수', '목', '금', '토', '일'];

// 기록 탭의 선택 상태를 탭 이동 후에도 기억
let remembered = null;

export function HistoryView() {
  const today = todayStr();
  const [sel, setSelRaw] = useState(remembered?.sel ?? today);
  const [ym, setYmRaw] = useState(remembered?.ym ?? { y: new Date().getFullYear(), m: new Date().getMonth() });
  const setSel = (v) => { remembered = { ...(remembered || { ym }), sel: v }; setSelRaw(v); };
  const setYm = (v) => { remembered = { ...(remembered || { sel }), ym: v }; setYmRaw(v); };

  const first = new Date(ym.y, ym.m, 1);
  const lastDay = new Date(ym.y, ym.m + 1, 0).getDate();
  const from = toDateStr(first);
  const to = toDateStr(new Date(ym.y, ym.m, lastDay));

  const byDate = useLive(async () => {
    const list = await db.workouts.where('date').between(from, to, true, true).toArray();
    const map = {};
    for (const w of list) {
      if (await isEmptyWorkout(w)) continue; // 시작만 하고 세트가 없는 기록은 점 표시 안 함
      (map[w.date] ||= new Set()).add(w.type);
    }
    return map;
  }, [from, to], {});

  const lead = (first.getDay() + 6) % 7; // 월요일 시작
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= lastDay; d++) cells.push(toDateStr(new Date(ym.y, ym.m, d)));

  const move = (n) => {
    const d = new Date(ym.y, ym.m + n, 1);
    setYm({ y: d.getFullYear(), m: d.getMonth() });
  };
  const goToday = () => {
    const d = new Date();
    setYm({ y: d.getFullYear(), m: d.getMonth() });
    setSel(today);
  };

  return html`
    <div class="page">
      <div class="cal-head">
        <button class="icon-btn" aria-label="이전 달" onClick=${() => move(-1)}>‹</button>
        <div class="cal-title">${ym.y}년 ${ym.m + 1}월</div>
        <button class="icon-btn" aria-label="다음 달" onClick=${() => move(1)}>›</button>
        <button class="btn small" onClick=${goToday}>오늘</button>
      </div>

      <div class="card cal">
        <div class="cal-grid">
          ${WEEK.map((w, i) => html`<div class=${'cal-wd ' + (i === 6 ? 'sun' : i === 5 ? 'sat' : '')}>${w}</div>`)}
          ${cells.map((d) => {
            if (!d) return html`<div></div>`;
            const types = byDate[d];
            return html`
              <button class=${'cal-day ' + (d === sel ? 'sel ' : '') + (d === today ? 'today ' : '') + (d > today ? 'future' : '')}
                onClick=${() => setSel(d)}>
                <span>${Number(d.slice(8))}</span>
                <span class="dots">
                  ${types?.has('strength') && html`<i class="dot strength"></i>`}
                  ${types?.has('cardio') && html`<i class="dot cardio"></i>`}
                </span>
              </button>`;
          })}
        </div>
        <div class="legend"><span><i class="dot strength"></i>근력</span><span><i class="dot cardio"></i>유산소</span></div>
      </div>

      <${DayDetail} date=${sel} />
    </div>`;
}

function DayDetail({ date }) {
  const exMap = useExercises();
  const list = useLive(async () => loadWorkoutDetails(await db.workouts.where('date').equals(date).toArray()), [date]);
  const cond = useLive(async () => {
    const c = await db.conditions.where('date').equals(date).first();
    const b = await db.body.where('date').equals(date).first();
    return [conditionText(c), bodyText(b)].filter(Boolean).join(' · ');
  }, [date], '');
  const today = todayStr();

  const remove = async (w) => {
    const ok = await confirmDialog({
      title: `${w.type === 'strength' ? '근력' : '유산소'} 기록 삭제`,
      message: `${fmtDate(date)} 기록을 삭제할까요? 되돌릴 수 없어요.`,
      okText: '삭제', danger: true,
    });
    if (ok) { await deleteWorkout(w.id); toast('삭제했어요'); }
  };

  // 그날 평균 강도(RPE): 근력 완료 세트 + 유산소 강도
  const rpes = (list || []).flatMap((w) =>
    w.type === 'strength' ? w.entries.flatMap((e) => e.sets.filter((s) => s.done && s.rpe).map((s) => s.rpe)) : w.cardio?.rpe ? [w.cardio.rpe] : []);
  const avgRpe = rpes.length ? Math.round((rpes.reduce((a, b) => a + b, 0) / rpes.length) * 10) / 10 : null;

  return html`
    <h2 class="section-title">${fmtDate(date)}</h2>
    ${(avgRpe || cond) && html`
      <div class="card day-cond">
        ${avgRpe && html`<div>🔥 평균 강도 <b>RPE ${avgRpe}</b> <span class="muted small">(${rpeLabel(avgRpe)})</span></div>`}
        ${cond && html`<div class="muted small">${cond}</div>`}
      </div>`}
    ${list && list.length === 0 && html`<div class="empty">이 날은 운동 기록이 없어요</div>`}
    ${list?.map((w) => html`
      <${WorkoutSummary} key=${w.id} w=${w} exMap=${exMap}>
        <div class="wc-actions">
          ${w.type === 'strength' && html`<button class="btn small" onClick=${() => saveWorkoutAsRoutine(w.id)}>루틴으로 저장</button>`}
          <button class="btn small" onClick=${() => openWorkout(w)}>수정</button>
          <button class="btn small danger-ghost" onClick=${() => remove(w)}>삭제</button>
        </div>
      <//>`)}
    ${date <= today && html`
      <div class="add-past">
        <button class="btn" onClick=${() => startStrength(date)}>+ 근력 추가</button>
        <button class="btn" onClick=${() => startCardio(date)}>+ 유산소 추가</button>
      </div>
      <div class="spacer"></div>
      <${DailyFold} date=${date} key=${date} />`}`;
}

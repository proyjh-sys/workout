// ③ 통계 탭 (그래프는 2단계에서 추가)
import { html } from '../vendor/preact-htm.mjs';
import { db, useLive } from '../db.js';
import { todayStr, addDays, parseDate, toDateStr } from '../util.js';

export function StatsView() {
  const today = todayStr();
  const s = useLive(async () => {
    const d = parseDate(today);
    const monday = addDays(today, -((d.getDay() + 6) % 7));
    const monthStart = toDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
    const count = async (from) => {
      const ws = await db.workouts.where('date').between(from, today, true, true).toArray();
      const cardio = await db.cardio.where('date').between(from, today, true, true).toArray();
      const sets = await db.sets.where('workoutId').anyOf(ws.map((w) => w.id)).filter((x) => x.done).count();
      return {
        strength: ws.filter((w) => w.type === 'strength').length,
        cardioMin: cardio.reduce((n, c) => n + (c.durationMin || 0), 0),
        sets,
      };
    };
    return { week: await count(monday), month: await count(monthStart), total: await db.workouts.count() };
  }, [today]);

  const Box = ({ title, v }) => html`
    <div class="card">
      <div class="field-label">${title}</div>
      <div class="stat-row">
        <div class="stat"><b>${v.strength}</b><span>근력 회</span></div>
        <div class="stat"><b>${v.sets}</b><span>세트</span></div>
        <div class="stat"><b>${v.cardioMin}</b><span>유산소 분</span></div>
      </div>
    </div>`;

  return html`
    <div class="page">
      <h1 class="page-title">통계</h1>
      ${s && html`
        <${Box} title="이번 주 (월요일부터)" v=${s.week} />
        <${Box} title="이번 달" v=${s.month} />
        <p class="hint center">전체 기록 ${s.total}건</p>`}
      <div class="empty">운동별 그래프와 개인 최고 기록은 2단계에서 추가돼요.</div>
    </div>`;
}

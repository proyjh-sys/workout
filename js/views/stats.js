// ③ 통계 탭: 주간 운동량, 부위별 세트, 운동별 추이, 개인 최고 기록
import { html, useState, useEffect, useRef } from '../vendor/preact-htm.mjs';
import { db, useLive, useExercises } from '../db.js';
import { epley, round1 } from '../progress.js';
import { todayStr, addDays, parseDate, toDateStr, fmtShort, fmtNum, PARTS, partLabel } from '../util.js';

const PERIODS = [
  { id: '4w', label: '4주', days: 28 },
  { id: '3m', label: '3개월', days: 91 },
  { id: '6m', label: '6개월', days: 182 },
  { id: '1y', label: '1년', days: 365 },
  { id: 'all', label: '전체', days: null },
];
let rememberedPeriod = '4w';
let rememberedEx = null;

/* ---------- Chart.js는 통계 탭을 처음 열 때만 불러옵니다 ---------- */
let chartLib = null;
function loadChart() {
  if (window.Chart) return Promise.resolve(window.Chart);
  chartLib ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = './js/vendor/chart.umd.min.js';
    s.onload = () => resolve(window.Chart);
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return chartLib;
}
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function ChartBox({ build, deps, height = 200 }) {
  const ref = useRef();
  useEffect(() => {
    let chart;
    let alive = true;
    loadChart().then((Chart) => {
      if (!alive || !ref.current) return;
      Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
      Chart.defaults.color = css('--muted');
      Chart.defaults.borderColor = css('--line');
      chart = new Chart(ref.current, build());
    });
    return () => { alive = false; chart?.destroy(); };
  }, deps);
  return html`<div class="chart-box" style=${`height:${height}px`}><canvas ref=${ref}></canvas></div>`;
}

const baseOpts = (extra = {}) => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: { display: false }, tooltip: { displayColors: true } },
  ...extra,
});

const mondayOf = (s) => addDays(s, -((parseDate(s).getDay() + 6) % 7));

/* ---------- 데이터 모으기 ---------- */
async function loadStats(from, to) {
  const workouts = await db.workouts.where('date').between(from, to, true, true).toArray();
  const ids = workouts.map((w) => w.id);
  const sets = (await db.sets.where('workoutId').anyOf(ids).toArray()).filter((s) => s.done);
  const cardio = await db.cardio.where('date').between(from, to, true, true).toArray();
  const exercises = Object.fromEntries((await db.exercises.toArray()).map((e) => [e.id, e]));

  // 주 단위 칸 만들기 (월요일 시작)
  const weeks = [];
  for (let d = mondayOf(from); d <= to; d = addDays(d, 7)) weeks.push(d);
  const wk = Object.fromEntries(weeks.map((w) => [w, { strength: 0, cardio: 0, cardioMin: 0, sets: 0 }]));
  const workoutHasSets = new Set(sets.map((s) => s.workoutId));
  for (const w of workouts) {
    const k = mondayOf(w.date);
    if (!wk[k]) continue;
    if (w.type === 'strength' && workoutHasSets.has(w.id)) wk[k].strength++;
    if (w.type === 'cardio') wk[k].cardio++;
  }
  for (const c of cardio) { const k = mondayOf(c.date); if (wk[k]) wk[k].cardioMin += c.durationMin || 0; }
  for (const s of sets) { const k = mondayOf(s.date); if (wk[k]) wk[k].sets++; }

  const byPart = Object.fromEntries(PARTS.map((p) => [p.id, 0]));
  for (const s of sets) { const p = exercises[s.exerciseId]?.part; if (p in byPart) byPart[p]++; }

  // 운동별 사용 횟수 (선택 목록용)
  const exCount = {};
  for (const s of sets) exCount[s.exerciseId] = (exCount[s.exerciseId] || 0) + 1;

  return {
    weeks, wk, byPart, exCount, sets,
    totals: {
      strength: Object.values(wk).reduce((n, v) => n + v.strength, 0),
      sets: sets.length,
      cardioMin: cardio.reduce((n, c) => n + (c.durationMin || 0), 0),
    },
  };
}

/** 운동 하나의 날짜별 최고 무게 / 추정 1RM / 볼륨 */
function exerciseSeries(sets) {
  const byDate = {};
  for (const s of sets) {
    const d = (byDate[s.date] ||= { date: s.date, maxW: 0, e1rm: 0, volume: 0, reps: 0, maxReps: 0 });
    d.maxW = Math.max(d.maxW, s.weightKg || 0);
    d.e1rm = Math.max(d.e1rm, epley(s.weightKg, s.reps));
    d.volume += (s.weightKg || 0) * (s.reps || 0);
    d.reps += s.reps || 0;
    d.maxReps = Math.max(d.maxReps, s.reps || 0);
  }
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
}

export function StatsView() {
  const [period, setPeriodRaw] = useState(rememberedPeriod);
  const setPeriod = (p) => { rememberedPeriod = p; setPeriodRaw(p); };
  const today = todayStr();
  const p = PERIODS.find((x) => x.id === period);
  const first = useLive(async () => (await db.workouts.orderBy('date').first())?.date ?? today, [], null);
  const from = p.days ? addDays(today, -(p.days - 1)) : first || today;

  const s = useLive(() => loadStats(from, today), [from, today]);
  const exMap = useExercises();

  return html`
    <div class="page">
      <h1 class="page-title">통계</h1>
      <div class="part-tabs">
        ${PERIODS.map((x) => html`<button class=${'part-tab ' + (period === x.id ? 'on' : '')} onClick=${() => setPeriod(x.id)}>${x.label}</button>`)}
      </div>

      ${s && html`
        <div class="card">
          <div class="stat-row">
            <div class="stat"><b>${s.totals.strength}</b><span>근력 회</span></div>
            <div class="stat"><b>${s.totals.sets}</b><span>세트</span></div>
            <div class="stat"><b>${s.totals.cardioMin}</b><span>유산소 분</span></div>
          </div>
        </div>

        <${WeeklyCharts} s=${s} key=${from} />
        <${PartChart} s=${s} key=${'p' + from} />
        <${ExerciseTrend} s=${s} exMap=${exMap} />
      `}
      <${PRList} exMap=${exMap} />
    </div>`;
}

function WeeklyCharts({ s }) {
  const labels = s.weeks.map(fmtShort);
  return html`
    <h2 class="section-title">주간 운동 횟수</h2>
    <div class="card">
      <${ChartBox} deps=${[s]} build=${() => ({
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: '근력', data: s.weeks.map((w) => s.wk[w].strength), backgroundColor: css('--strength'), borderRadius: 4, stack: 'a' },
            { label: '유산소', data: s.weeks.map((w) => s.wk[w].cardio), backgroundColor: css('--cardio'), borderRadius: 4, stack: 'a' },
          ],
        },
        options: baseOpts({
          plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10 } } },
          scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } },
        }),
      })} />
    </div>
    <h2 class="section-title">주간 유산소 시간 (분)</h2>
    <div class="card">
      <${ChartBox} deps=${[s]} height=${170} build=${() => ({
        type: 'bar',
        data: { labels, datasets: [{ label: '유산소(분)', data: s.weeks.map((w) => s.wk[w].cardioMin), backgroundColor: css('--cardio'), borderRadius: 4 }] },
        options: baseOpts({ scales: { x: { grid: { display: false } }, y: { beginAtZero: true } } }),
      })} />
    </div>`;
}

function PartChart({ s }) {
  return html`
    <h2 class="section-title">부위별 세트 수</h2>
    <div class="card">
      <${ChartBox} deps=${[s]} height=${190} build=${() => ({
        type: 'bar',
        data: {
          labels: PARTS.map((p) => p.label),
          datasets: [{ label: '세트', data: PARTS.map((p) => s.byPart[p.id]), backgroundColor: css('--strength'), borderRadius: 4 }],
        },
        options: baseOpts({ indexAxis: 'y', scales: { x: { beginAtZero: true, ticks: { precision: 0 } }, y: { grid: { display: false } } } }),
      })} />
    </div>`;
}

function ExerciseTrend({ s, exMap }) {
  const ids = Object.keys(s.exCount).sort((a, b) => s.exCount[b] - s.exCount[a]);
  const [exId, setExRaw] = useState(rememberedEx && ids.includes(rememberedEx) ? rememberedEx : ids[0]);
  const [metric, setMetric] = useState('e1rm');
  const setEx = (v) => { rememberedEx = v; setExRaw(v); };
  const cur = ids.includes(exId) ? exId : ids[0];

  if (!ids.length) return html`<h2 class="section-title">운동별 추이</h2><div class="empty">이 기간에 근력 기록이 없어요</div>`;

  const ex = exMap[cur];
  const series = exerciseSeries(s.sets.filter((x) => x.exerciseId === cur));
  const bodyweight = series.every((d) => d.maxW === 0);
  const sec = ex?.repUnit === 'sec';
  const metrics = bodyweight
    ? [{ id: 'maxReps', label: sec ? '최고 시간' : '최고 횟수', unit: sec ? '초' : '회' }, { id: 'reps', label: sec ? '총 시간' : '총 횟수', unit: sec ? '초' : '회' }]
    : [{ id: 'maxW', label: '최고 무게', unit: 'kg' }, { id: 'e1rm', label: '추정 1RM', unit: 'kg' }, { id: 'volume', label: '볼륨', unit: 'kg' }];
  const m = metrics.find((x) => x.id === metric) ?? metrics[0];
  const values = series.map((d) => round1(d[m.id]));

  return html`
    <h2 class="section-title">운동별 추이</h2>
    <div class="card">
      <select class="select" value=${cur} onChange=${(e) => setEx(e.target.value)}>
        ${ids.map((id) => html`<option value=${id}>${exMap[id]?.name ?? '?'} (${s.exCount[id]}세트)</option>`)}
      </select>
      <div class="chip-row">
        ${metrics.map((x) => html`<button class=${'mini-chip ' + (m.id === x.id ? 'on' : '')} onClick=${() => setMetric(x.id)}>${x.label}</button>`)}
      </div>
      <${ChartBox} deps=${[cur, m.id, s]} build=${() => ({
        type: 'line',
        data: {
          labels: series.map((d) => fmtShort(d.date)),
          datasets: [{
            label: `${m.label}(${m.unit})`, data: values, borderColor: css('--accent'), backgroundColor: css('--accent'),
            tension: 0.25, pointRadius: 4, pointHoverRadius: 6,
          }],
        },
        options: baseOpts({ scales: { x: { grid: { display: false } }, y: { beginAtZero: m.id === 'volume' || bodyweight } } }),
      })} />
      ${series.length === 1 && html`<p class="hint center">기록이 2번 이상 쌓이면 선으로 이어져요</p>`}
      ${m.id === 'e1rm' && html`<p class="hint">추정 1RM = 무게 × (1 + 횟수 ÷ 30) · Epley 공식. 한 번에 들 수 있는 최대 무게의 추정치예요.</p>`}
    </div>`;
}

/** 전체 기간 개인 최고 기록 */
function PRList({ exMap }) {
  const rows = useLive(async () => {
    const best = {};
    await db.sets.each((s) => {
      if (!s.done) return;
      const b = (best[s.exerciseId] ||= { maxW: -1, maxWDate: '', maxWReps: 0, e1rm: 0, e1rmDate: '', maxReps: 0, maxRepsDate: '', n: 0 });
      b.n++;
      const w = s.weightKg || 0;
      if (w > b.maxW || (w === b.maxW && s.reps > b.maxWReps)) { b.maxW = w; b.maxWDate = s.date; b.maxWReps = s.reps; }
      const e = epley(w, s.reps);
      if (e > b.e1rm) { b.e1rm = e; b.e1rmDate = s.date; }
      if (!w && s.reps > b.maxReps) { b.maxReps = s.reps; b.maxRepsDate = s.date; }
    });
    return Object.entries(best).sort((a, b) => b[1].n - a[1].n);
  }, [], []);

  return html`
    <h2 class="section-title">개인 최고 기록 🏆</h2>
    ${rows.length === 0 && html`<div class="empty">근력 기록이 쌓이면 여기에 표시돼요</div>`}
    ${rows.length > 0 && html`
      <div class="card list">
        ${rows.map(([id, b]) => {
          const ex = exMap[id];
          const u = ex?.repUnit === 'sec' ? '초' : '회';
          return html`
            <div class="list-item pr-item" key=${id}>
              <div>
                <div class="pr-name">${ex?.name ?? '(삭제된 운동)'}</div>
                <div class="muted small">${ex ? partLabel(ex.part) : ''}</div>
              </div>
              <div class="pr-vals">
                ${b.maxW > 0
                  ? html`
                    <div><b>${fmtNum(b.maxW)}kg</b> × ${b.maxWReps}${u} <span class="muted small">${fmtShort(b.maxWDate)}</span></div>
                    <div class="muted small">1RM 추정 ${fmtNum(round1(b.e1rm))}kg</div>`
                  : html`<div><b>${b.maxReps}${u}</b> <span class="muted small">${fmtShort(b.maxRepsDate)}</span></div>`}
              </div>
            </div>`;
        })}
      </div>`}`;
}

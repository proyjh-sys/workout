// ③ 통계 탭: 주간 운동량, 부위별 세트, 운동별 추이, 개인 최고 기록
import { html, useState, useEffect, useRef } from '../vendor/preact-htm.mjs';
import { db, useLive, useExercises, getSetting } from '../db.js';
import { epley, round1 } from '../progress.js';
import { bmiLabel, bmiKind } from './daily.js';
import { todayStr, addDays, parseDate, toDateStr, fmtShort, fmtNum, PARTS, partLabel, toUnit, fmtSetWeight } from '../util.js';

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

  // 신체: 주마다 마지막으로 잰 값 (운동량 그래프와 같은 주 단위로 비교)
  const body = (await db.body.where('date').between(from, to, true, true).toArray()).sort((a, b) => a.date.localeCompare(b.date));
  const bodyWk = Object.fromEntries(weeks.map((w) => [w, { weightKg: null, waistCm: null, bmi: null }]));
  for (const b of body) {
    const k = mondayOf(b.date);
    if (!bodyWk[k]) continue;
    if (b.weightKg != null) bodyWk[k].weightKg = b.weightKg;
    if (b.waistCm != null) bodyWk[k].waistCm = b.waistCm;
    if (b.bmi != null) bodyWk[k].bmi = b.bmi;
  }

  // 컨디션과 운동 강도: 날짜별
  const conds = await db.conditions.where('date').between(from, to, true, true).toArray();
  const daily = {};
  const day = (d) => (daily[d] ||= { date: d, rpes: [], sleep: null, fatigue: null, pain: 0 });
  for (const s of sets) if (s.rpe) day(s.date).rpes.push(s.rpe);
  for (const c of cardio) if (c.rpe) day(c.date).rpes.push(c.rpe);
  for (const c of conds) {
    const d = day(c.date);
    d.sleep = c.sleep ?? null; d.fatigue = c.fatigue ?? null;
    d.pain = (c.pains || []).reduce((m, p) => Math.max(m, p.level), 0);
  }
  const dailyList = Object.values(daily).sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ ...d, rpe: d.rpes.length ? Math.round((d.rpes.reduce((a, b) => a + b, 0) / d.rpes.length) * 10) / 10 : null }));

  // BMI: 직접 입력한 값만 사용
  const bmis = body.filter((b) => b.bmi != null);
  const lastBmi = bmis[bmis.length - 1] ?? null;
  const firstBmi = bmis[0] ?? null;

  return {
    weeks, wk, byPart, exCount, sets, bodyWk, hasBody: body.length > 0, dailyList, hasCond: conds.length > 0,
    lastBmi, firstBmi, hasBmi: bmis.length > 0,
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
  const unit = useLive(() => getSetting('defaultUnit', 'kg'), [], 'kg');

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
        <${ExerciseTrend} s=${s} exMap=${exMap} unit=${unit} />
        <${BodyChart} s=${s} key=${'b' + from} />
        <${CondChart} s=${s} key=${'c' + from} />
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

function ExerciseTrend({ s, exMap, unit = 'kg' }) {
  const ids = Object.keys(s.exCount).sort((a, b) => s.exCount[b] - s.exCount[a]);
  const [exId, setExRaw] = useState(rememberedEx && ids.includes(rememberedEx) ? rememberedEx : ids[0]);
  const [metric, setMetric] = useState('e1rm');
  const setEx = (v) => { rememberedEx = v; setExRaw(v); };
  const cur = ids.includes(exId) ? exId : ids[0];

  if (!ids.length) return html`<h2 class="section-title">운동별 추이</h2><div class="empty">이 기간에 근력 기록이 없어요</div>`;

  const ex = exMap[cur];
  const wu = ex?.unit || unit;
  const series = exerciseSeries(s.sets.filter((x) => x.exerciseId === cur));
  const bodyweight = series.every((d) => d.maxW === 0);
  const sec = ex?.repUnit === 'sec';
  const metrics = bodyweight
    ? [{ id: 'maxReps', label: sec ? '최고 시간' : '최고 횟수', unit: sec ? '초' : '회' }, { id: 'reps', label: sec ? '총 시간' : '총 횟수', unit: sec ? '초' : '회' }]
    : [{ id: 'maxW', label: '최고 무게', unit: wu }, { id: 'e1rm', label: '추정 1RM', unit: wu }, { id: 'volume', label: '볼륨', unit: wu }];
  const m = metrics.find((x) => x.id === metric) ?? metrics[0];
  // 무게 값은 이 운동의 단위(없으면 기본 단위)로 바꿔서 표시
  const values = series.map((d) => round1(bodyweight ? d[m.id] : toUnit(d[m.id], wu)));

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
      if (w > b.maxW || (w === b.maxW && s.reps > b.maxWReps)) { b.maxW = w; b.maxWDate = s.date; b.maxWReps = s.reps; b.unit = s.unit || 'kg'; }
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
                    <div><b>${fmtSetWeight({ weightKg: b.maxW, unit: b.unit })}</b> × ${b.maxWReps}${u} <span class="muted small">${fmtShort(b.maxWDate)}</span></div>
                    <div class="muted small">1RM 추정 ${fmtNum(round1(toUnit(b.e1rm, b.unit)))}${b.unit}</div>`
                  : html`<div><b>${b.maxReps}${u}</b> <span class="muted small">${fmtShort(b.maxRepsDate)}</span></div>`}
              </div>
            </div>`;
        })}
      </div>`}`;
}

/** 신체 변화: 운동량 그래프와 같은 주 단위 */
function BodyChart({ s }) {
  if (!s.hasBody) return html`
    <h2 class="section-title">신체 변화</h2>
    <div class="empty">오늘 탭 → '컨디션 · 체중 기록'에서 체중·허리둘레를 입력하면 여기에 그래프가 생겨요</div>`;
  const labels = s.weeks.map(fmtShort);
  return html`
    <h2 class="section-title">신체 변화 (주별 마지막 측정값)</h2>
    <div class="card">
      <${ChartBox} deps=${[s]} build=${() => ({
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: '체중(kg)', data: s.weeks.map((w) => s.bodyWk[w].weightKg), borderColor: css('--accent'), backgroundColor: css('--accent'), yAxisID: 'y', spanGaps: true, tension: 0.25, pointRadius: 4 },
            { label: '허리(cm)', data: s.weeks.map((w) => s.bodyWk[w].waistCm), borderColor: css('--cardio'), backgroundColor: css('--cardio'), yAxisID: 'y1', spanGaps: true, tension: 0.25, pointRadius: 4 },
          ],
        },
        options: baseOpts({
          plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10 } } },
          scales: {
            x: { grid: { display: false } },
            y: { position: 'left', title: { display: true, text: 'kg' } },
            y1: { position: 'right', grid: { display: false }, title: { display: true, text: 'cm' } },
          },
        }),
      })} />
      <p class="hint">위의 주간 운동 그래프와 같은 주 단위라 함께 비교할 수 있어요.</p>
      ${s.hasBmi && html`
        <div class="field-label">BMI (직접 입력한 값)</div>
        <${ChartBox} deps=${[s]} height=${150} build=${() => ({
          type: 'line',
          data: { labels, datasets: [{ label: 'BMI', data: s.weeks.map((w) => s.bodyWk[w].bmi), borderColor: css('--warn-text'), backgroundColor: css('--warn-text'), spanGaps: true, tension: 0.25, pointRadius: 4 }] },
          options: baseOpts({ scales: { x: { grid: { display: false } } } }),
        })} />
        <div class="bmi-row">
          <span class=${'bmi-badge ' + bmiKind(s.lastBmi.bmi)}>최근 BMI <b>${fmtNum(s.lastBmi.bmi)}</b> · ${bmiLabel(s.lastBmi.bmi)}</span>
          ${s.firstBmi !== s.lastBmi && html`<span class="muted small">기간 시작 ${fmtNum(s.firstBmi.bmi)} → 지금 ${fmtNum(s.lastBmi.bmi)}</span>`}
        </div>`}
    </div>`;
}

/** 컨디션과 운동 강도: 날짜별 평균 RPE(막대) + 수면·피로도(선) */
function CondChart({ s }) {
  const list = s.dailyList;
  if (!s.hasCond || !list.length) return html`
    <h2 class="section-title">컨디션과 운동 강도</h2>
    <div class="empty">수면·피로도를 입력하면 운동 강도와 함께 볼 수 있어요</div>`;
  return html`
    <h2 class="section-title">컨디션과 운동 강도</h2>
    <div class="card">
      <${ChartBox} deps=${[s]} height=${220} build=${() => ({
        data: {
          labels: list.map((d) => fmtShort(d.date)),
          datasets: [
            { type: 'bar', label: '강도(RPE)', data: list.map((d) => d.rpe), backgroundColor: css('--accent-soft'), borderColor: css('--accent'), borderWidth: 1, borderRadius: 4, yAxisID: 'y' },
            { type: 'line', label: '수면(1~5)', data: list.map((d) => d.sleep), borderColor: css('--cardio'), backgroundColor: css('--cardio'), yAxisID: 'y1', spanGaps: true, pointRadius: 3, tension: 0.2 },
            { type: 'line', label: '피로(1~5)', data: list.map((d) => d.fatigue), borderColor: css('--danger'), backgroundColor: css('--danger'), yAxisID: 'y1', spanGaps: true, pointRadius: 3, tension: 0.2 },
          ],
        },
        options: baseOpts({
          plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10 } } },
          scales: {
            x: { grid: { display: false } },
            y: { min: 0, max: 10, position: 'left', title: { display: true, text: 'RPE' } },
            y1: { min: 0, max: 5, position: 'right', grid: { display: false }, ticks: { stepSize: 1 } },
          },
        }),
      })} />
      ${list.some((d) => d.pain) && html`
        <p class="hint">통증 기록한 날: ${list.filter((d) => d.pain).map((d) => `${fmtShort(d.date)}(${['', '약함', '중간', '심함'][d.pain]})`).join(', ')}</p>`}
    </div>`;
}

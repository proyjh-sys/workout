// 3단계: 체중·허리둘레, 컨디션·통증 입력 + 주간 목표 달성률
import { html } from '../vendor/preact-htm.mjs';
import { db, useLive, saveBody, saveCondition, getSetting, isEmptyWorkout } from '../db.js';
import { Stepper } from '../components.js';
import { go } from '../ui.js';
import { todayStr, addDays, parseDate, fmtNum, vibrate } from '../util.js';

export const SLEEP = ['매우 나쁨', '나쁨', '보통', '좋음', '매우 좋음'];
export const FATIGUE = ['거뜬', '약간', '보통', '피곤', '매우 피곤'];
export const PAIN_PARTS = ['목', '어깨', '팔꿈치', '손목', '등', '허리', '엉덩이', '무릎', '발목', '기타'];
export const PAIN_LEVEL = ['', '약함', '중간', '심함'];

export const DEFAULT_GOAL = { strengthCount: 3, cardioMin: 90 };

/** 컨디션 한 줄 요약 (기록 탭, AI 내보내기에서 사용) */
export function conditionText(c) {
  if (!c) return '';
  const parts = [];
  if (c.sleep) parts.push(`수면 ${c.sleep}/5(${SLEEP[c.sleep - 1]})`);
  if (c.fatigue) parts.push(`피로 ${c.fatigue}/5(${FATIGUE[c.fatigue - 1]})`);
  if (c.pains?.length) parts.push('통증 ' + c.pains.map((p) => `${p.part}(${PAIN_LEVEL[p.level]})`).join(', '));
  return parts.join(' · ');
}
/* ---------- BMI: 사용자가 직접 입력 (자동 계산하지 않음) · 판정은 대한비만학회 기준 ---------- */
export function bmiLabel(v) {
  if (v == null) return '';
  if (v < 18.5) return '저체중';
  if (v < 23) return '정상';
  if (v < 25) return '비만 전단계';
  if (v < 30) return '1단계 비만';
  if (v < 35) return '2단계 비만';
  return '3단계 비만';
}
export const bmiKind = (v) => (v == null ? '' : v < 18.5 ? 'low' : v < 23 ? 'ok' : v < 25 ? 'warn' : 'high');

export function bodyText(b) {
  if (!b) return '';
  return [
    b.weightKg != null ? `체중 ${fmtNum(b.weightKg)}kg` : null,
    b.bmi != null ? `BMI ${fmtNum(b.bmi)}(${bmiLabel(b.bmi)})` : null,
    b.waistCm != null ? `허리 ${fmtNum(b.waistCm)}cm` : null,
  ].filter(Boolean).join(' · ');
}

/** 5단계 버튼 (다시 누르면 지움) */
function Scale5({ value, labels, onChange, reverse }) {
  return html`
    <div class=${'scale5 ' + (reverse ? 'rev' : '')}>
      ${labels.map((l, i) => html`
        <button class=${'s5 ' + (value === i + 1 ? 'on' : '')} onClick=${() => { vibrate(); onChange(value === i + 1 ? null : i + 1); }}>
          <b>${i + 1}</b><span>${l}</span>
        </button>`)}
    </div>`;
}

/** 날짜 하나의 체중·허리·컨디션·통증 입력. 누르는 즉시 저장돼요. */
export function DailyPanel({ date }) {
  const d = useLive(async () => {
    const body = await db.body.where('date').equals(date).first();
    const cond = await db.conditions.where('date').equals(date).first();
    // 처음 입력할 때 기본값: 가장 최근 체중·허리
    const prev = (await db.body.where('date').belowOrEqual(date).reverse().sortBy('date'));
    const lastW = prev.find((b) => b.weightKg != null)?.weightKg ?? 70;
    const lastWaist = prev.find((b) => b.waistCm != null)?.waistCm ?? 80;
    const lastBmi = prev.find((b) => b.bmi != null)?.bmi ?? 22;
    return { body, cond, lastW, lastWaist, lastBmi };
  }, [date]);
  if (!d) return html`<div></div>`;
  const { body, cond } = d;
  const pains = cond?.pains ?? [];

  const togglePain = (part) => {
    vibrate();
    const cur = pains.find((p) => p.part === part);
    let next;
    if (!cur) next = [...pains, { part, level: 1 }];
    else if (cur.level < 3) next = pains.map((p) => (p.part === part ? { ...p, level: p.level + 1 } : p));
    else next = pains.filter((p) => p.part !== part);
    saveCondition(date, { pains: next });
  };

  return html`
    <div class="daily">
      <div class="two-col">
        <div>
          <div class="field-label">체중</div>
          ${body?.weightKg != null
            ? html`<${Stepper} label="체중 (kg)" value=${body.weightKg} step=${0.1} unit="kg" display=${(v) => `${fmtNum(v)}`}
                onChange=${(v) => saveBody(date, { weightKg: Math.round(v * 10) / 10 })} />
              <button class="link small-link" onClick=${() => saveBody(date, { weightKg: null })}>지우기</button>`
            : html`<button class="btn full" onClick=${() => saveBody(date, { weightKg: d.lastW })}>+ 체중 입력</button>`}
        </div>
        <div>
          <div class="field-label">허리둘레</div>
          ${body?.waistCm != null
            ? html`<${Stepper} label="허리둘레 (cm)" value=${body.waistCm} step=${0.5} unit="cm" display=${(v) => `${fmtNum(v)}`}
                onChange=${(v) => saveBody(date, { waistCm: Math.round(v * 10) / 10 })} />
              <button class="link small-link" onClick=${() => saveBody(date, { waistCm: null })}>지우기</button>`
            : html`<button class="btn full" onClick=${() => saveBody(date, { waistCm: d.lastWaist })}>+ 허리 입력</button>`}
        </div>
      </div>
      <div class="field-label">BMI (체중계·인바디 값을 직접 입력)</div>
      ${body?.bmi != null
        ? html`<${Stepper} label="BMI" value=${body.bmi} step=${0.1} display=${(v) => `${fmtNum(v)}`}
            onChange=${(v) => saveBody(date, { bmi: Math.round(v * 10) / 10 })} />
          <div class="bmi-row">
            <span class=${'bmi-badge ' + bmiKind(body.bmi)}>${bmiLabel(body.bmi)}</span>
            <button class="link small-link" onClick=${() => saveBody(date, { bmi: null })}>지우기</button>
          </div>`
        : html`<button class="btn full" onClick=${() => saveBody(date, { bmi: d.lastBmi })}>+ BMI 입력</button>`}
      <p class="hint">체중은 kg, 허리는 cm · 숫자를 누르면 직접 입력</p>

      <div class="field-label">수면 상태</div>
      <${Scale5} value=${cond?.sleep} labels=${SLEEP} onChange=${(v) => saveCondition(date, { sleep: v })} />
      <div class="field-label">피로도</div>
      <${Scale5} value=${cond?.fatigue} labels=${FATIGUE} reverse onChange=${(v) => saveCondition(date, { fatigue: v })} />

      <div class="field-label">통증 (누를 때마다 약함 → 중간 → 심함 → 없음)</div>
      <div class="pain-grid">
        ${PAIN_PARTS.map((part) => {
          const p = pains.find((x) => x.part === part);
          return html`<button class=${'pain-chip lv' + (p?.level || 0)} onClick=${() => togglePain(part)}>
            <b>${part}</b><span>${p ? PAIN_LEVEL[p.level] : ' '}</span></button>`;
        })}
      </div>
    </div>`;
}

/* ---------- 주간 목표 ---------- */
export const mondayOf = (s) => addDays(s, -((parseDate(s).getDay() + 6) % 7));

export async function weekProgress(date = todayStr()) {
  const goal = { ...DEFAULT_GOAL, ...(await getSetting('weeklyGoal', {})) };
  const from = mondayOf(date);
  const to = addDays(from, 6);
  const ws = await db.workouts.where('date').between(from, to, true, true).toArray();
  let strength = 0;
  for (const w of ws) if (w.type === 'strength' && !(await isEmptyWorkout(w))) strength++;
  const cardio = await db.cardio.where('date').between(from, to, true, true).toArray();
  const cardioMin = cardio.reduce((n, c) => n + (c.durationMin || 0), 0);
  return { goal, from, to, strength, cardioMin };
}

function Bar({ label, value, target, unit, kind }) {
  const pct = target ? Math.min(100, Math.round((value / target) * 100)) : 0;
  return html`
    <div class="goal-row">
      <div class="goal-top"><span>${label}</span><span><b>${value}</b> / ${target}${unit} ${pct >= 100 ? '🎉' : ''}</span></div>
      <div class="goal-bar"><div class=${'goal-fill ' + kind} style=${`width:${pct}%`}></div></div>
    </div>`;
}

export function WeeklyGoalCard() {
  const p = useLive(() => weekProgress(), []);
  if (!p) return null;
  const total = Math.round(
    ((Math.min(1, p.strength / (p.goal.strengthCount || 1)) + Math.min(1, p.cardioMin / (p.goal.cardioMin || 1))) / 2) * 100,
  );
  return html`
    <section class="card goal-card" onClick=${() => go({ name: 'goals' })}>
      <div class="goal-head"><span class="section-inline">이번 주 목표</span><span class="goal-pct">${total}%</span></div>
      <${Bar} label="💪 근력" value=${p.strength} target=${p.goal.strengthCount} unit="회" kind="strength" />
      <${Bar} label="🏃 유산소" value=${p.cardioMin} target=${p.goal.cardioMin} unit="분" kind="cardio" />
    </section>`;
}

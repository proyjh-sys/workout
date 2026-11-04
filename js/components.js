// 여러 화면에서 같이 쓰는 작은 부품들
import { html } from './vendor/preact-htm.mjs';
import { numberPrompt, back } from './ui.js';
import { fmtNum, fmtSetWeight, rpeLabel, cardioLabel, partLabel, vibrate } from './util.js';

/** [-] 값 [+] 조절기. 가운데 숫자를 누르면 직접 입력 */
export function Stepper({ value, step, min = 0, unit, label, onChange, display, decimal = true }) {
  const change = (d) => {
    vibrate();
    const n = Math.max(min, Math.round((Number(value) + d) * 100) / 100);
    onChange(n);
  };
  const edit = async () => {
    const n = await numberPrompt({ title: label, value, unit, decimal });
    if (n != null) onChange(Math.max(min, n));
  };
  return html`
    <div class="stepper">
      <button class="step-btn" aria-label=${label + ' 줄이기'} onClick=${() => change(-step)}>−</button>
      <button class="step-value" onClick=${edit}>
        <span class="step-num">${display ? display(value) : fmtNum(value)}</span>
        ${unit && !display && html`<span class="step-unit">${unit}</span>`}
      </button>
      <button class="step-btn" aria-label=${label + ' 늘리기'} onClick=${() => change(step)}>+</button>
    </div>`;
}

export function TopBar({ title, sub, onBack = back, backLabel = '‹ 뒤로', right }) {
  return html`
    <header class="topbar">
      <button class="topbar-back" onClick=${onBack}>${backLabel}</button>
      <div class="topbar-title">
        <div>${title}</div>
        ${sub && html`<div class="topbar-sub">${sub}</div>`}
      </div>
      <div class="topbar-right">${right}</div>
    </header>`;
}

export const repUnitLabel = (ex) => (ex?.repUnit === 'sec' ? '초' : '회');

export function setText(s, ex) {
  return `${fmtSetWeight(s)} × ${fmtNum(s.reps)}${repUnitLabel(ex)}`;
}

/** 운동 한 건 요약 카드 (오늘 탭, 기록 탭에서 사용) */
export function WorkoutSummary({ w, exMap, onClick, children }) {
  if (w.type === 'strength') {
    const done = w.entries.map((e) => ({ ...e, sets: e.sets.filter((s) => s.done) })).filter((e) => e.sets.length || e.note);
    const total = done.reduce((n, e) => n + e.sets.length, 0);
    return html`
      <div class="card workout-card strength" onClick=${onClick}>
        <div class="wc-head">
          <span class="badge strength">근력</span>
          <span class="wc-meta">${total ? `${done.length}개 운동 · ${total}세트` : '진행 중'}</span>
        </div>
        ${total === 0 && html`<div class="muted">완료한 세트가 아직 없어요 · 눌러서 이어하기</div>`}
        ${done.map((e) => {
          const ex = exMap[e.exerciseId];
          return html`
            <div class="wc-ex">
              <div class="wc-ex-name">${ex?.name ?? '(삭제된 운동)'} <span class="muted small">${ex ? partLabel(ex.part) : ''}</span></div>
              <div class="wc-sets">${e.sets.map((s) => html`<span class="chip">${setText(s, ex)}${s.rpe ? ' · ' + rpeLabel(s.rpe) : ''}</span>`)}</div>
              ${e.note && html`<div class="wc-note">📝 ${e.note}</div>`}
            </div>`;
        })}
        ${children}
      </div>`;
  }
  const c = w.cardio || {};
  const extra = [
    c.distanceKm ? `${fmtNum(c.distanceKm)}km` : null,
    c.avgHr ? `심박 ${c.avgHr}` : null,
    c.kcal ? `${c.kcal}kcal` : null,
    c.rpe ? rpeLabel(c.rpe) : null,
  ].filter(Boolean);
  return html`
    <div class="card workout-card cardio" onClick=${onClick}>
      <div class="wc-head">
        <span class="badge cardio">유산소</span>
        <span class="wc-meta">${cardioLabel(c.kind)} · ${fmtNum(c.durationMin)}분</span>
      </div>
      ${extra.length > 0 && html`<div class="wc-sets">${extra.map((x) => html`<span class="chip">${x}</span>`)}</div>`}
      ${c.note && html`<div class="wc-note">📝 ${c.note}</div>`}
      ${children}
    </div>`;
}

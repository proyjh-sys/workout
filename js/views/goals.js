// 주간 목표 설정 화면
import { html } from '../vendor/preact-htm.mjs';
import { useLive, getSetting, setSetting } from '../db.js';
import { TopBar, Stepper } from '../components.js';
import { DEFAULT_GOAL, weekProgress } from './daily.js';
import { fmtShort } from '../util.js';

export function GoalsView() {
  const g = useLive(async () => ({ ...DEFAULT_GOAL, ...(await getSetting('weeklyGoal', {})) }), []);
  const p = useLive(() => weekProgress(), []);
  if (!g) return html`<div class="page"></div>`;
  const save = (patch) => setSetting('weeklyGoal', { ...g, ...patch });

  return html`
    <div class="page has-topbar">
      <${TopBar} title="주간 목표" />
      <div class="card">
        <div class="field-label">근력 운동 (주당 횟수)</div>
        <${Stepper} label="근력 횟수" value=${g.strengthCount} step=${1} min=${0} decimal=${false} display=${(v) => `${v}회`}
          onChange=${(v) => save({ strengthCount: Math.round(v) })} />
        <div class="field-label">유산소 운동 (주당 시간)</div>
        <${Stepper} label="유산소 시간 (분)" value=${g.cardioMin} step=${10} min=${0} decimal=${false} display=${(v) => `${v}분`}
          onChange=${(v) => save({ cardioMin: Math.round(v) })} />
        <p class="hint">한 주는 월요일에 시작해요. 바꾸면 바로 저장돼요.</p>
      </div>
      ${p && html`
        <div class="card">
          <div class="field-label">이번 주 (${fmtShort(p.from)} ~ ${fmtShort(p.to)})</div>
          <div>근력 <b>${p.strength}</b> / ${g.strengthCount}회 · 유산소 <b>${p.cardioMin}</b> / ${g.cardioMin}분</div>
        </div>`}
    </div>`;
}

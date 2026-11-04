// AI 코치용 내보내기: 기간을 고르면 Claude에 붙여넣기 좋은 텍스트를 만들어 복사
// (앱에 AI를 연결하지 않고, API 키도 쓰지 않아요)
import { html, useState } from '../vendor/preact-htm.mjs';
import { db, useLive, getSetting } from '../db.js';
import { TopBar } from '../components.js';
import { toast } from '../ui.js';
import { epley, round1 } from '../progress.js';
import { DEFAULT_GOAL, conditionText, bodyText, mondayOf } from './daily.js';
import {
  todayStr, addDays, fmtDate, fmtNum, fmtSetWeight, toUnit, partLabel, cardioLabel, rpeLabel, CARDIO_KINDS,
} from '../util.js';

const PERIODS = [
  { id: 28, label: '최근 4주' },
  { id: 56, label: '최근 8주' },
  { id: 91, label: '최근 3개월' },
  { id: 182, label: '최근 6개월' },
];

const REQUEST = `너는 내 개인 트레이너야. 아래는 내 운동 기록 앱에서 내보낸 기록이야.
나는 유산소(보통 30분)와 근력 운동을 하루씩 번갈아 해. 강도는 RPE(1~10)로 기록했어.
수면은 1(매우 나쁨)~5(매우 좋음), 피로도는 1(거뜬)~5(매우 피곤)이야.

기록을 분석해서 다음 순서로 알려 줘.
1. 잘한 점: 꾸준함, 늘어난 무게·횟수, 목표 달성 등
2. 정체된 운동: 무게나 횟수가 몇 주째 늘지 않는 운동과 그 원인 추정, 돌파 방법
3. 과부하·부상 위험: 강도(RPE)가 계속 높거나, 통증·피로·수면 상태가 나빠지는 신호, 부위별 세트 불균형
4. 다음 4주 계획: 주별로 근력(운동·세트·횟수·목표 무게)과 유산소(종류·시간) 일정. 증량·디로드 시점도 포함

답은 한국어로, 핵심부터 짧고 구체적으로 써 줘.`;

const wd = (s) => fmtDate(s).match(/\((.)\)/)?.[1] ?? '';

export async function buildCoachText(days) {
  const to = todayStr();
  const from = addDays(to, -(days - 1));
  const exMap = Object.fromEntries((await db.exercises.toArray()).map((e) => [e.id, e]));
  const workouts = (await db.workouts.where('date').between(from, to, true, true).toArray())
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startedAt || '').localeCompare(b.startedAt || ''));
  const ids = workouts.map((w) => w.id);
  const entries = await db.entries.where('workoutId').anyOf(ids).toArray();
  const sets = (await db.sets.where('workoutId').anyOf(ids).toArray()).filter((s) => s.done);
  const cardio = await db.cardio.where('date').between(from, to, true, true).toArray();
  const body = (await db.body.where('date').between(from, to, true, true).toArray()).sort((a, b) => a.date.localeCompare(b.date));
  const conds = await db.conditions.where('date').between(from, to, true, true).toArray();
  const condBy = Object.fromEntries(conds.map((c) => [c.date, c]));
  const goal = { ...DEFAULT_GOAL, ...(await getSetting('weeklyGoal', {})) };

  const L = [];
  L.push(REQUEST, '', '---', `# 운동 기록 (${from} ~ ${to}, ${days}일)`, '');

  // 요약
  const strengthDays = new Set(sets.map((s) => s.workoutId)).size;
  const cardioMin = cardio.reduce((n, c) => n + (c.durationMin || 0), 0);
  L.push('## 요약');
  L.push(`- 근력 ${strengthDays}회, 총 ${sets.length}세트 / 유산소 ${cardio.length}회, 총 ${cardioMin}분`);
  L.push(`- 주간 목표: 근력 ${goal.strengthCount}회, 유산소 ${goal.cardioMin}분`);

  // 주별 달성
  L.push('', '## 주별 운동량 (월요일 시작)');
  for (let w = mondayOf(from); w <= to; w = addDays(w, 7)) {
    const end = addDays(w, 6);
    const ss = sets.filter((s) => s.date >= w && s.date <= end);
    const st = new Set(ss.map((s) => s.workoutId)).size;
    const cm = cardio.filter((c) => c.date >= w && c.date <= end).reduce((n, c) => n + (c.durationMin || 0), 0);
    L.push(`- ${w} 주: 근력 ${st}회(${ss.length}세트), 유산소 ${cm}분`);
  }

  // 부위별 세트
  const byPart = {};
  for (const s of sets) { const p = partLabel(exMap[s.exerciseId]?.part ?? ''); byPart[p] = (byPart[p] || 0) + 1; }
  L.push('', '## 부위별 세트 수');
  L.push('- ' + Object.entries(byPart).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p} ${n}`).join(', '));

  // 운동별 변화
  L.push('', '## 운동별 변화 (첫 기록 → 마지막 기록, 추정 1RM은 Epley 공식)');
  const byEx = {};
  for (const s of sets) (byEx[s.exerciseId] ||= []).push(s);
  for (const [id, ss] of Object.entries(byEx).sort((a, b) => b[1].length - a[1].length)) {
    const ex = exMap[id];
    const dates = [...new Set(ss.map((s) => s.date))].sort();
    const best = (d) => ss.filter((s) => s.date === d).reduce((a, b) => (epley(b.weightKg, b.reps) > epley(a.weightKg, a.reps) ? b : a));
    const f = best(dates[0]);
    const l = best(dates[dates.length - 1]);
    const u = l.unit || 'kg';
    const e1 = (s) => `${fmtNum(round1(toUnit(epley(s.weightKg, s.reps), u)))}${u}`;
    const bw = ss.every((s) => !s.weightKg);
    L.push(bw
      ? `- ${ex?.name}: ${dates.length}회, 최고 ${Math.max(...ss.map((s) => s.reps))}${ex?.repUnit === 'sec' ? '초' : '회'}`
      : `- ${ex?.name}: ${dates.length}회 · ${fmtSetWeight(f)}×${f.reps} → ${fmtSetWeight(l)}×${l.reps} · 추정 1RM ${e1(f)} → ${e1(l)}`);
  }

  // 날짜별 상세
  L.push('', '## 날짜별 기록');
  const days2 = [...new Set([...workouts.map((w) => w.date), ...conds.map((c) => c.date)])].sort();
  for (const d of days2) {
    const c = condBy[d];
    const ws = workouts.filter((w) => w.date === d);
    const lines = [];
    for (const w of ws) {
      if (w.type === 'strength') {
        const es = entries.filter((e) => e.workoutId === w.id).sort((a, b) => a.order - b.order);
        const parts = es.map((e) => {
          const ss = sets.filter((s) => s.entryId === e.id).sort((a, b) => a.order - b.order);
          if (!ss.length) return null;
          const ex = exMap[e.exerciseId];
          const u = ex?.repUnit === 'sec' ? '초' : '';
          return `  - ${ex?.name}: ${ss.map((s) => `${fmtSetWeight(s)}×${s.reps}${u}${s.rpe ? ' @' + s.rpe : ''}`).join(', ')}${e.note ? ` (메모: ${e.note})` : ''}`;
        }).filter(Boolean);
        if (parts.length) lines.push(`- 근력${w.routineName ? ` [${w.routineName}]` : ''}`, ...parts);
      } else {
        const cc = cardio.find((x) => x.workoutId === w.id);
        if (!cc) continue;
        const extra = [cc.distanceKm ? `${fmtNum(cc.distanceKm)}km` : '', cc.avgHr ? `평균심박 ${cc.avgHr}` : '', cc.kcal ? `${cc.kcal}kcal` : '', cc.rpe ? `RPE ${cc.rpe}` : '']
          .filter(Boolean).join(', ');
        lines.push(`- 유산소: ${cardioLabel(cc.kind)} ${cc.durationMin}분${extra ? ` (${extra})` : ''}${cc.note ? ` 메모: ${cc.note}` : ''}`);
      }
    }
    const ct = conditionText(c);
    if (!lines.length && !ct) continue;
    L.push(`### ${d} (${wd(d)})${ct ? ` — ${ct}` : ''}`, ...lines);
  }

  // 신체
  L.push('', '## 신체 기록 (BMI는 직접 입력한 값, 판정은 대한비만학회 기준)');
  if (body.length) for (const b of body) { const t = bodyText(b); if (t) L.push(`- ${b.date}: ${t}`); }
  else L.push('- 기록 없음');

  return L.join('\n');
}

export function AIExportView() {
  const [days, setDays] = useState(28);
  const text = useLive(() => buildCoachText(days), [days], '');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('복사했어요! Claude 대화창에 붙여넣기 하세요');
    } catch {
      // 복사가 막히면 글자를 모두 선택해 두어 직접 복사할 수 있게
      const ta = document.getElementById('ai-text');
      ta?.focus(); ta?.select();
      toast('길게 눌러 \'복사\'를 선택하세요');
    }
  };
  const share = async () => {
    try { await navigator.share({ text }); } catch {}
  };

  return html`
    <div class="page has-topbar">
      <${TopBar} title="AI 코치용 내보내기" />
      <div class="part-tabs">
        ${PERIODS.map((p) => html`<button class=${'part-tab ' + (days === p.id ? 'on' : '')} onClick=${() => setDays(p.id)}>${p.label}</button>`)}
      </div>
      <button class="big-btn primary" onClick=${copy} disabled=${!text}>📋 분석 요청문과 함께 복사</button>
      ${navigator.share && html`<button class="btn full" onClick=${share}>공유하기 (Claude 앱으로 보내기)</button>`}
      <p class="hint">복사한 뒤 Claude 앱이나 claude.ai 대화창에 붙여넣으면 돼요. 앱은 AI에 직접 연결되지 않아요.</p>
      <div class="field-label">미리보기 (${text.length.toLocaleString()}자)</div>
      <textarea id="ai-text" class="note-input ai-preview" readonly value=${text}></textarea>
    </div>`;
}

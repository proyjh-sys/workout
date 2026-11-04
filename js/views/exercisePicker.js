// 운동 고르기 (부위별, 자주 쓰는 운동이 위로)
import { html, useState } from '../vendor/preact-htm.mjs';
import { db, useLive, exerciseUsage, addExercise } from '../db.js';
import { PARTS } from '../util.js';
import { closeSheet, toast } from '../ui.js';

export function PartTabs({ value, onChange }) {
  return html`
    <div class="part-tabs">
      ${PARTS.map((p) => html`
        <button class=${'part-tab ' + (value === p.id ? 'on' : '')} onClick=${() => onChange(p.id)}>${p.label}</button>`)}
    </div>`;
}

export function sortExercises(list, usage) {
  return [...list].sort((a, b) =>
    (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) ||
    (usage[b.id] || 0) - (usage[a.id] || 0) ||
    a.name.localeCompare(b.name, 'ko'));
}

export function ExercisePicker({ onPick, initialPart = 'chest', alreadyIds = [] }) {
  const [part, setPart] = useState(initialPart);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  const data = useLive(async () => {
    const usage = await exerciseUsage();
    const list = (await db.exercises.where('part').equals(part).toArray()).filter((e) => !e.archived);
    return { list: sortExercises(list, usage), usage };
  }, [part]);

  const pick = (ex) => { closeSheet(); onPick(ex); };

  const save = async () => {
    const n = name.trim();
    if (!n) return;
    const dup = await db.exercises.where('part').equals(part).filter((e) => e.name === n).first();
    if (dup) {
      if (dup.archived) await db.exercises.update(dup.id, { archived: false });
      toast('이미 있는 운동이라 그 운동을 선택했어요');
      return pick(dup);
    }
    const ex = await addExercise({ name: n, part });
    toast(`'${n}' 운동을 추가했어요`);
    pick(ex);
  };

  return html`
    <div class="picker">
      <div class="sheet-title">운동 선택</div>
      <${PartTabs} value=${part} onChange=${(p) => { setPart(p); setAdding(false); }} />
      <div class="picker-list">
        ${data?.list.map((ex) => html`
          <button class="picker-item" key=${ex.id} onClick=${() => pick(ex)}>
            <span class="picker-name">${ex.favorite ? '★ ' : ''}${ex.name}</span>
            <span class="picker-sub">
              ${alreadyIds.includes(ex.id) ? '오늘 함 · ' : ''}${data.usage[ex.id] ? `${data.usage[ex.id]}회 기록` : ''}
            </span>
          </button>`)}
      </div>
      ${adding
        ? html`
          <div class="add-row">
            <input class="text-input" placeholder="새 운동 이름" value=${name}
              onInput=${(e) => setName(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && save()} autofocus />
            <button class="btn primary" onClick=${save}>추가</button>
          </div>`
        : html`<button class="btn ghost full" onClick=${() => setAdding(true)}>+ 새 운동 추가 (${PARTS.find((p) => p.id === part).label})</button>`}
    </div>`;
}

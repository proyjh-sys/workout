// 휴식 타이머: 시작 시각을 기준으로 계산하므로 화면이 잠깐 꺼졌다 켜져도 정확합니다.
import { html, useState, useEffect } from './vendor/preact-htm.mjs';
import { getSetting } from './db.js';

const KEY = 'restTimer';
let state = load(); // { endAt, total } | null
let alerted = false;
const listeners = new Set();

function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); return s && s.endAt > Date.now() - 5000 ? s : null; } catch { return null; }
}
function save() {
  try { state ? localStorage.setItem(KEY, JSON.stringify(state)) : localStorage.removeItem(KEY); } catch {}
}
function emit() { save(); listeners.forEach((f) => f(state)); }

export function startRest(sec) {
  state = { endAt: Date.now() + sec * 1000, total: sec };
  alerted = false;
  emit();
}
export function addRest(sec) {
  if (!state) return;
  const left = Math.max(0, state.endAt - Date.now());
  const next = Math.max(0, left + sec * 1000);
  state = { endAt: Date.now() + next, total: Math.max(state.total, Math.round(next / 1000)) };
  alerted = next <= 0;
  emit();
}
export function stopRest() { state = null; emit(); }

/* ---------- 소리 ---------- */
let ctx = null;
/** 버튼을 누를 때 불러서 소리 재생을 미리 허락받아 둡니다 (아이폰 규칙) */
export function unlockAudio() {
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    g.gain.value = 0.0001; o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.01);
  } catch {}
}
function beep() {
  try {
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    [0, 0.25, 0.5].forEach((t) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = 880; o.type = 'sine';
      const s = ctx.currentTime + t;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.4, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.18);
      o.connect(g).connect(ctx.destination); o.start(s); o.stop(s + 0.2);
    });
  } catch {}
}

export const fmtClock = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

/** 화면 아래에 떠 있는 휴식 타이머 막대 */
export function RestBar() {
  const [s, setS] = useState(state);
  const [, tick] = useState(0);
  useEffect(() => {
    listeners.add(setS);
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => { listeners.delete(setS); clearInterval(id); };
  }, []);
  if (!s) return null;
  const leftMs = s.endAt - Date.now();
  const left = Math.max(0, Math.ceil(leftMs / 1000));
  const done = leftMs <= 0;

  if (done && !alerted) {
    alerted = true;
    getSetting('restSound', true).then((on) => on && beep());
    try { navigator.vibrate?.([200, 100, 200]); } catch {}
    setTimeout(() => { if (state && state.endAt <= Date.now()) stopRest(); }, 4000);
  }
  const pct = done ? 100 : Math.min(100, 100 - (leftMs / (s.total * 1000)) * 100);

  return html`
    <div class=${'restbar ' + (done ? 'done' : '')}>
      <div class="restbar-fill" style=${`width:${pct}%`}></div>
      <div class="restbar-body">
        <div class="restbar-time">
          <span class="muted small">${done ? '휴식 끝!' : '휴식'}</span>
          <b>${done ? '다음 세트 💪' : fmtClock(left)}</b>
        </div>
        ${!done && html`
          <button class="rb-btn" onClick=${() => addRest(-15)}>−15</button>
          <button class="rb-btn" onClick=${() => addRest(15)}>+15</button>`}
        <button class="rb-btn primary" onClick=${stopRest}>${done ? '닫기' : '건너뛰기'}</button>
      </div>
    </div>`;
}

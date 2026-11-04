// 화면 이동, 알림(토스트), 확인창, 숫자 입력창 등 공용 UI 상태
import { html, useState, useEffect, useRef } from './vendor/preact-htm.mjs';

let state = {
  tab: 'today',
  route: null, // { name: 'strength'|'cardio'|'exercises', ...params }
  toast: null,
  dialog: null,
  sheet: null,
};
const listeners = new Set();

function set(patch) {
  state = { ...state, ...patch };
  listeners.forEach((f) => f(state));
}

export function useUI() {
  const [s, setS] = useState(state);
  useEffect(() => {
    listeners.add(setS);
    return () => listeners.delete(setS);
  }, []);
  return s;
}

/* ---------- 이동 ---------- */
export const setTab = (tab) => { set({ tab, route: null }); window.scrollTo(0, 0); };
export const go = (route) => { set({ route }); window.scrollTo(0, 0); };
export const back = () => { set({ route: null }); window.scrollTo(0, 0); };

/* ---------- 토스트 ---------- */
let toastTimer;
export function toast(msg, opts = {}) {
  clearTimeout(toastTimer);
  set({ toast: { msg, action: opts.action, id: Date.now() } });
  toastTimer = setTimeout(() => set({ toast: null }), opts.duration ?? 2600);
}

/* ---------- 확인창 ---------- */
export function confirmDialog({ title, message = '', okText = '확인', cancelText = '취소', danger = false }) {
  return new Promise((resolve) => {
    set({
      dialog: {
        title, message, okText, cancelText, danger,
        done: (v) => { set({ dialog: null }); resolve(v); },
      },
    });
  });
}

/* ---------- 숫자 입력창 ---------- */
export function numberPrompt({ title, value, unit = '', decimal = true }) {
  return new Promise((resolve) => {
    set({
      dialog: {
        kind: 'number', title, value, unit, decimal,
        done: (v) => { set({ dialog: null }); resolve(v); },
      },
    });
  });
}

/* ---------- 아래에서 올라오는 시트 ---------- */
export function openSheet(render) { set({ sheet: render }); }
export function closeSheet() { set({ sheet: null }); }

/* ---------- 렌더링 ---------- */
function NumberDialog({ d }) {
  const [v, setV] = useState(d.value == null ? '' : String(d.value));
  const ref = useRef();
  useEffect(() => { setTimeout(() => { ref.current?.focus(); ref.current?.select(); }, 50); }, []);
  const ok = () => {
    const n = parseFloat(v.replace(',', '.'));
    d.done(Number.isFinite(n) && n >= 0 ? n : null);
  };
  return html`
    <div class="dialog">
      <div class="dialog-title">${d.title}</div>
      <div class="num-input-row">
        <input ref=${ref} class="num-input" type="text" inputmode=${d.decimal ? 'decimal' : 'numeric'}
          value=${v} onInput=${(e) => setV(e.target.value)}
          onKeyDown=${(e) => e.key === 'Enter' && ok()} />
        <span class="num-unit">${d.unit}</span>
      </div>
      <div class="dialog-actions">
        <button class="btn" onClick=${() => d.done(null)}>취소</button>
        <button class="btn primary" onClick=${ok}>확인</button>
      </div>
    </div>`;
}

export function Overlays() {
  const s = useUI();
  const d = s.dialog;
  return html`
    ${s.sheet && html`
      <div class="backdrop" onClick=${closeSheet}></div>
      <div class="sheet" role="dialog">
        <div class="sheet-handle"></div>
        ${s.sheet()}
      </div>`}
    ${d && html`
      <div class="backdrop top" onClick=${() => d.done(d.kind === 'number' ? null : false)}></div>
      ${d.kind === 'number'
        ? html`<${NumberDialog} d=${d} key=${d.title} />`
        : html`
          <div class="dialog">
            <div class="dialog-title">${d.title}</div>
            ${d.message && html`<div class="dialog-msg">${d.message}</div>`}
            <div class="dialog-actions">
              <button class="btn" onClick=${() => d.done(false)}>${d.cancelText}</button>
              <button class=${'btn ' + (d.danger ? 'danger' : 'primary')} onClick=${() => d.done(true)}>${d.okText}</button>
            </div>
          </div>`}`}
    ${s.toast && html`
      <div class="toast" key=${s.toast.id}>
        <span>${s.toast.msg}</span>
        ${s.toast.action && html`<button class="toast-btn" onClick=${() => { s.toast.action.run(); set({ toast: null }); }}>${s.toast.action.label}</button>`}
      </div>`}
  `;
}

/* ---------- 화면 꺼짐 방지 ---------- */
export function useWakeLock() {
  useEffect(() => {
    let lock = null;
    let alive = true;
    const req = async () => {
      try {
        if ('wakeLock' in navigator && document.visibilityState === 'visible') {
          lock = await navigator.wakeLock.request('screen');
          if (!alive) lock.release();
        }
      } catch {}
    };
    const onVis = () => document.visibilityState === 'visible' && req();
    req();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVis);
      try { lock?.release(); } catch {}
    };
  }, []);
}

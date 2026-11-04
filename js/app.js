// 앱 시작점: 하단 탭과 화면 전환
import { html, render } from './vendor/preact-htm.mjs';
import { requestPersistence } from './db.js';
import { useUI, setTab, Overlays, toast } from './ui.js';
import { TodayView } from './views/today.js';
import { HistoryView } from './views/history.js';
import { StatsView } from './views/stats.js';
import { SettingsView, ExercisesView } from './views/settings.js';
import { StrengthView } from './views/strength.js';
import { CardioView } from './views/cardio.js';
import { RoutinesView, RoutineEditor } from './views/routines.js';

const TABS = [
  { id: 'today', label: '오늘', icon: '<path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/><circle cx="12" cy="12" r="4"/>' },
  { id: 'history', label: '기록', icon: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>' },
  { id: 'stats', label: '통계', icon: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>' },
  { id: 'settings', label: '설정', icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>' },
];

function App() {
  const ui = useUI();
  const r = ui.route;

  let screen;
  if (r?.name === 'strength') screen = html`<${StrengthView} workoutId=${r.workoutId} key=${r.workoutId} />`;
  else if (r?.name === 'cardio') screen = html`<${CardioView} workoutId=${r.workoutId} date=${r.date} key=${r.workoutId || 'new' + r.date} />`;
  else if (r?.name === 'exercises') screen = html`<${ExercisesView} />`;
  else if (r?.name === 'routines') screen = html`<${RoutinesView} />`;
  else if (r?.name === 'routine') screen = html`<${RoutineEditor} id=${r.id} key=${r.id || 'new'} />`;
  else if (ui.tab === 'history') screen = html`<${HistoryView} />`;
  else if (ui.tab === 'stats') screen = html`<${StatsView} />`;
  else if (ui.tab === 'settings') screen = html`<${SettingsView} />`;
  else screen = html`<${TodayView} />`;

  return html`
    <main class=${r ? 'no-tabs' : ''}>${screen}</main>
    ${!r && html`
      <nav class="tabbar">
        ${TABS.map((t) => html`
          <button class=${'tab ' + (ui.tab === t.id ? 'on' : '')} onClick=${() => setTab(t.id)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
              dangerouslySetInnerHTML=${{ __html: t.icon }}></svg>
            <span>${t.label}</span>
          </button>`)}
      </nav>`}
    <${Overlays} />`;
}

render(html`<${App} />`, document.getElementById('app'));
requestPersistence();

// 오프라인 사용을 위한 서비스 워커 등록 + 업데이트 알림
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW 등록 실패', e));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) {
      toast('새 버전이 준비됐어요', { duration: 15000, action: { label: '새로고침', run: () => location.reload() } });
    }
  });
}

// 서비스 워커: 앱 파일을 기기에 저장해서 오프라인에서도 열리게 합니다.
// ⚠️ 새 버전을 배포할 때마다 아래 숫자를 올려 주세요. (기록 데이터는 지워지지 않아요)
const CACHE_VERSION = 'v1.0.0';
const CACHE = `workout-log-${CACHE_VERSION}`;

const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/seed.js',
  './js/ui.js',
  './js/util.js',
  './js/components.js',
  './js/backup.js',
  './js/version.js',
  './js/views/today.js',
  './js/views/strength.js',
  './js/views/cardio.js',
  './js/views/history.js',
  './js/views/stats.js',
  './js/views/settings.js',
  './js/views/exercisePicker.js',
  './js/vendor/preact-htm.mjs',
  './js/vendor/dexie.mjs',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('workout-log-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // 화면(HTML) 요청은 저장해 둔 index.html로
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('./index.html').then((r) => r || fetch(req)));
    return;
  }
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    })),
  );
});

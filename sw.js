// 打卡記錄 service worker：離線快取（改咗檔案就改 VERSION）
const VERSION = 'punchclock-v11';
const ASSETS = [
  './',
  './index.html',
  './core.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 網絡優先，但最多等 3 秒；網絡太慢或者斷網就用快取 → 有更新會即刻攞到，訊號差都一撳就開到
const NETWORK_TIMEOUT = 3000;

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  const isPage = e.request.mode === 'navigate';
  const network = fetch(e.request).then(res => {
    // 只快取正常回應，唔好俾 404 / 500 蓋咗快取入面好嘅版本
    if (res.ok) {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
    }
    return res;
  });
  const fromCache = () => caches.match(e.request, { ignoreSearch: true })
    .then(r => r || (isPage ? caches.match('./index.html') : undefined));
  // 超時用快取；快取冇就繼續等網絡
  const timeout = new Promise(resolve => setTimeout(resolve, NETWORK_TIMEOUT)).then(fromCache)
    .then(r => r || network);
  e.respondWith(
    Promise.race([network, timeout])
      .catch(() => fromCache().then(r => r || Response.error()))
  );
  e.waitUntil(network.catch(() => {}));
});

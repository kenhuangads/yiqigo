// Service Worker：離線殼層＋CDN 模型快取＋翻譯結果快取
const VERSION = 'yiqigo-v1.4.0';
const SHELL_CACHE = `${VERSION}-shell`;
const CDN_CACHE = `${VERSION}-cdn`;
const API_CACHE = `${VERSION}-api`;

const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/config.js',
  './js/store.js',
  './js/ui.js',
  './js/speech.js',
  './js/translator.js',
  './js/taiwanize.js',
  './js/ocr.js',
  './js/vision.js',
  './js/conversation.js',
  './js/camera.js',
  './js/text.js',
  './js/photo.js',
  './js/phrasebook.js',
  './js/data/phrases.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

const CDN_HOSTS = ['cdn.jsdelivr.net', 'tessdata.projectnaptha.com', 'unpkg.com'];
const API_HOSTS = ['translate.googleapis.com', 'api.mymemory.translated.net'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === location.origin) {
    // 頁面導覽走網路優先，確保修正版能在下次開啟時立即生效；其餘資源快取優先
    if (request.mode === 'navigate') e.respondWith(networkFirst(request, SHELL_CACHE));
    else e.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
  } else if (CDN_HOSTS.includes(url.hostname)) {
    e.respondWith(cacheFirst(request, CDN_CACHE));
  } else if (API_HOSTS.includes(url.hostname)) {
    e.respondWith(networkFirst(request, API_CACHE));
  }
});

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetching = fetch(request)
    .then(res => { if (res.ok) cache.put(request, res.clone()); return res; })
    .catch(() => null);
  return cached || (await fetching) || offlineFallback();
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached; // 離線時重複的翻譯查詢仍可命中快取
    throw err;
  }
}

function offlineFallback() {
  return new Response('目前離線', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

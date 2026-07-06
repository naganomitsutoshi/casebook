// Casebook service worker（v8.1）
// 方針: アプリ本体（navigate）は network-first — 「更新が届かなくなる」事故を構造的に防ぐ。
// 静的アセット（icons/manifest）のみ cache-first。同一オリジンの GET 以外は一切触らない（外部送信なしは不変）。
// キルスイッチ: 更新が届かない事故時は本ファイルを「self.registration.unregister()＋全キャッシュ削除」だけの
// 内容に差し替えて配備する（手順は HANDOFF §20）。
const CACHE = "casebook-v8.1.0";
const ASSETS = ["./", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if(req.method !== "GET"){ return; }
  const url = new URL(req.url);
  if(url.origin !== self.location.origin){ return; }
  if(req.mode === "navigate"){
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put("./", copy)).catch(() => {});
        return res;
      }).catch(() => caches.match("./"))
    );
    return;
  }
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
      return res;
    }))
  );
});

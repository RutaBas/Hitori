/*
 * sw.js — cache-first app shell service worker.
 *
 * Update strategy IS the cache name: bump CACHE_NAME on every deploy. skipWaiting +
 * clients.claim make the new worker take over immediately; old caches are purged on
 * activate. Same-origin shell is served cache-first; anything else falls through to the
 * network (e.g. the Google Fonts stylesheet).
 */
const CACHE_NAME = "hitori-v1";

const SHELL = [
  "./",
  "index.html",
  "manifest.json",
  "css/tokens.css",
  "css/styles.css",
  "js/rules.js",
  "js/board.js",
  "js/solver.js",
  "js/generator.js",
  "js/ui.js",
  // NOTE: skyline.svg is NOT listed — its markup is inlined directly into index.html, so
  // the file is a design source, not a runtime asset. Precaching it would make install
  // fail (cache.addAll rejects on any miss) if the source file isn't deployed.
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  // Only serve the same-origin shell from cache; let cross-origin (fonts) hit the network.
  if (new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      // Runtime-cache same-origin GETs so later navigations work fully offline.
      if (res && res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
      }
      return res;
    }).catch(() => caches.match("index.html")))
  );
});

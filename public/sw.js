const CACHE_NAME = "sanctuary-v4";  /* bumped to v4 */
const SHELL = [
  "/",
  "/index.html",
  "/icon-192.png",
  "/icon-512.png",
  "/images/SAI.png",
  "/fonts/Alice-Regular.ttf",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(SHELL))
  );
  self.skipWaiting(); /* activate immediately */
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        /* Don't cache API calls or dynamic content */
        if (req.url.includes("/api/")) return res;
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, clone));
        return res;
      })
      .catch(() => caches.match(req).then((res) => res))
  );
});

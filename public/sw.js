const CACHE_NAME = "sanctuary-v2";
const SHELL = [
  "/",
  "/index.html",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable.png",
  "/images/SAI.png",
  "/fonts/Alice-Regular.ttf",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(SHELL)));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  e.respondWith(
    caches.match(req).then((res) => res || fetch(req).then((nf) => nf))
  );
});

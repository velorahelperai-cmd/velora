/* Velora static cache — images and fonts for return visits.
   Development does not register or keep this worker, and never caches Next.js files. */
const CACHE = "velora-static-v1";
const DEV =
  self.location.hostname === "localhost" || self.location.hostname === "127.0.0.1";

const PRECACHE = [
  "/assets/velora/hero-environment-v2.png",
  "/assets/velora/phone-frame-v1.png",
  "/assets/velora/chat-girl.jpg",
  "/fonts/velora/IBMPlexSansArabic-Regular.woff2",
  "/fonts/velora/IBMPlexSansArabic-Medium.woff2",
  "/fonts/velora/IBMPlexSansArabic-Bold.woff2",
  "/fonts/velora/IBMPlexSans-Regular.woff2",
  "/fonts/velora/IBMPlexSans-Medium.woff2",
  "/fonts/velora/IBMPlexSans-Bold.woff2",
];

function isCacheable(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/fonts/")) return true;
  return false;
}

self.addEventListener("install", (event) => {
  if (DEV) {
    event.waitUntil(self.skipWaiting());
    return;
  }
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      if (DEV) {
        await caches.delete(CACHE);
        const windows = await self.clients.matchAll({ type: "window" });
        await self.registration.unregister();
        await Promise.all(windows.map((client) => client.navigate(client.url)));
        return;
      }
      const cache = await caches.open(CACHE);
      const keys = await cache.keys();
      await Promise.all(
        keys
          .filter((request) => new URL(request.url).pathname.startsWith("/_next/"))
          .map((request) => cache.delete(request)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  if (DEV) return;
  const { request } = event;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (!isCacheable(url)) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      } catch (err) {
        if (cached) return cached;
        throw err;
      }
    }),
  );
});

/* Retirement worker for existing installations only. HTTP/Next owns static
   caching. Keep this URL available so old cache-first workers can update. */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Only our legacy cache; never another application's storage.
    await caches.delete("velora-static-v1");
    await self.clients.claim();
    await self.registration.unregister();
  })());
});
// No fetch handler: HTML, APIs, private media and static assets use normal HTTP.

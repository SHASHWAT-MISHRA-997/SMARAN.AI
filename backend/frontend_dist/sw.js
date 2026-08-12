/**
 * SMARAN.AI — Service Worker SELF-DESTRUCT
 * This SW exists only to unregister itself and wipe all old caches.
 * After it runs, no service worker will ever be registered again.
 * Nginx cache-control headers handle everything going forward.
 */

// Activate immediately — don't wait for old SW to finish
self.addEventListener('install', () => {
  self.skipWaiting();
});

// On activate: wipe all caches, unregister self, force clients to reload fresh
self.addEventListener('activate', (event) => {
  event.waitUntil(
    // Step 1: Delete every cache that exists
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => {
        // Step 2: Unregister this service worker
        return self.registration.unregister();
      })
      .then(() => {
        // Step 3: Force all open tabs/windows to reload fresh from server
        return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      })
      .then((clients) => {
        clients.forEach((client) => {
          // Navigate each client to its current URL — loads fresh without any SW
          client.navigate(client.url);
        });
      })
  );
});

// Do NOT intercept any fetches — pass everything through to the network
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});

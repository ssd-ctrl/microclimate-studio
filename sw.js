const CACHE_NAME = "microclimate-studio-v8";
const APP_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./src/main.js",
  "./src/environment.js",
  "./src/generator.js",
  "./src/three-view.js",
  "./manifest.webmanifest",
  "./icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;

  event.respondWith(
    (async () => {
      if (isSameOrigin) {
        try {
          const networkResponse = await fetch(event.request);
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        } catch (_error) {
          const cached = await caches.match(event.request);
          if (cached) {
            return cached;
          }
          throw _error;
        }
      }

      const cached = await caches.match(event.request);
      if (cached) {
        return cached;
      }
      return fetch(event.request);
    })()
  );
});

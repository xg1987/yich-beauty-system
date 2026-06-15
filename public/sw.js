const ICON_VERSION = "0.1.248";
const CACHE_NAME = `yich-beauty-pwa-v${ICON_VERSION}`;
const APP_SHELL_ASSETS = [
  "/",
  `/manifest.webmanifest?v=${ICON_VERSION}`,
  `/favicon.ico?v=${ICON_VERSION}`,
  `/favicon-16x16.png?v=${ICON_VERSION}`,
  `/favicon-32x32.png?v=${ICON_VERSION}`,
  `/app-icon-192.png?v=${ICON_VERSION}`,
  `/app-icon-512.png?v=${ICON_VERSION}`,
  `/maskable-icon-512.png?v=${ICON_VERSION}`,
  `/apple-touch-icon.png?v=${ICON_VERSION}`,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL_ASSETS))
      .catch(() => undefined),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith("yich-beauty-pwa-") && cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName)),
      ))
      .then(() => undefined),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/")));
    return;
  }

  if (["script", "style", "worker"].includes(request.destination)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (["font", "image", "manifest"].includes(request.destination)) {
    event.respondWith(cacheFirst(request));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok) {
      cache.put(request, response.clone()).catch(() => undefined);
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error("Network request failed");
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    cache.put(request, response.clone()).catch(() => undefined);
  }
  return response;
}

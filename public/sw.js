const ICON_VERSION = "0.1.316";
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
  `/ios-splash/splash-1080x2340.png?v=${ICON_VERSION}`,
  `/ios-splash/splash-640x1136.png?v=${ICON_VERSION}`,
  `/ios-splash/splash-750x1334.png?v=${ICON_VERSION}`,
  `/ios-splash/splash-750x1624.png?v=${ICON_VERSION}`,
  `/ios-splash/splash-1125x2436.png?v=${ICON_VERSION}`,
  `/ios-splash/splash-828x1792.png?v=${ICON_VERSION}`,
  `/ios-splash/splash-1242x2208.png?v=${ICON_VERSION}`,
  `/ios-splash/splash-1242x2688.png?v=${ICON_VERSION}`,
  `/ios-splash/splash-1170x2532.png?v=${ICON_VERSION}`,
  `/ios-splash/splash-1179x2556.png?v=${ICON_VERSION}`,
  `/ios-splash/splash-1206x2622.png?v=${ICON_VERSION}`,
  `/ios-splash/splash-1284x2778.png?v=${ICON_VERSION}`,
  `/ios-splash/splash-1290x2796.png?v=${ICON_VERSION}`,
  `/ios-splash/splash-1320x2868.png?v=${ICON_VERSION}`,
  `/ios-splash/splash-1536x2048.png?v=${ICON_VERSION}`,
  `/ios-splash/splash-1668x2388.png?v=${ICON_VERSION}`,
  `/ios-splash/splash-2048x2732.png?v=${ICON_VERSION}`,
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
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
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(navigationShell(request));
    return;
  }

  if (["script", "style", "worker"].includes(request.destination)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (["font", "image", "manifest"].includes(request.destination)) {
    event.respondWith(cacheFirst(request));
  }
});

async function navigationShell(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok && isHtmlResponse(response)) {
      cache.put("/", response.clone()).catch(() => undefined);
      return response;
    }
  } catch {
    // Fall through to the cached shell for offline use.
  }

  const fallbackShell = await cache.match("/");
  if (fallbackShell) return fallbackShell;
  throw new Error("Navigation request failed");
}

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

function isHtmlResponse(response) {
  return response.headers.get("content-type")?.includes("text/html") ?? false;
}

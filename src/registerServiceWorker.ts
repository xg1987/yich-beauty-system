export function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !import.meta.env.PROD) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => registration.update().catch(() => undefined))
      .catch(() => undefined);
  });
}

export function disableViewportZoom() {
  const viewportContent = "width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";
  const lockViewportMeta = () => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (meta) meta.content = viewportContent;
  };

  const preventZoom = (event: Event) => {
    event.preventDefault();
  };

  const preventMultiTouchZoom = (event: TouchEvent) => {
    if (event.touches.length > 1) event.preventDefault();
  };

  let lastTouchEndAt = 0;
  const preventDoubleTapZoom = (event: TouchEvent) => {
    const now = Date.now();
    if (now - lastTouchEndAt <= 300) event.preventDefault();
    lastTouchEndAt = now;
  };

  const preventWheelZoom = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) event.preventDefault();
  };

  lockViewportMeta();
  window.addEventListener("pageshow", lockViewportMeta);
  document.addEventListener("visibilitychange", lockViewportMeta);
  document.addEventListener("gesturestart", preventZoom, { passive: false, capture: true });
  document.addEventListener("gesturechange", preventZoom, { passive: false, capture: true });
  document.addEventListener("gestureend", preventZoom, { passive: false, capture: true });
  document.addEventListener("touchstart", preventMultiTouchZoom, { passive: false, capture: true });
  document.addEventListener("touchmove", preventMultiTouchZoom, { passive: false, capture: true });
  document.addEventListener("touchend", preventDoubleTapZoom, { passive: false, capture: true });
  document.addEventListener("dblclick", preventZoom, { passive: false, capture: true });
  window.addEventListener("wheel", preventWheelZoom, { passive: false, capture: true });
}

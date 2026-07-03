export function disableViewportZoom() {
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

  document.addEventListener("gesturestart", preventZoom, { passive: false });
  document.addEventListener("gesturechange", preventZoom, { passive: false });
  document.addEventListener("touchmove", preventMultiTouchZoom, { passive: false });
  document.addEventListener("touchend", preventDoubleTapZoom, { passive: false });
}

import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

async function bootstrap() {
  const { disableViewportZoom } = await import("./disableViewportZoom");
  disableViewportZoom();
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
  void import("./registerServiceWorker").then(({ registerServiceWorker }) => registerServiceWorker());
  void import("./appUpdate").then(({ installAppUpdateChecker }) => installAppUpdateChecker());
}

void bootstrap();

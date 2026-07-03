import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installAppUpdateChecker } from "./appUpdate";
import { disableViewportZoom } from "./disableViewportZoom";
import { registerServiceWorker } from "./registerServiceWorker";
import "./styles.css";

disableViewportZoom();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

registerServiceWorker();
installAppUpdateChecker();

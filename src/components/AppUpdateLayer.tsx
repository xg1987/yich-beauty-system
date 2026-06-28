import { useEffect, useState } from "react";
import { APP_UPDATE_AVAILABLE_EVENT, dismissAppUpdatePrompt, reloadForAppUpdate } from "../appUpdate";
import { AppUpdatePrompt, appUpdateInfoFromEvent } from "./AppUpdatePrompt";
import type { AppUpdateInfo } from "./AppUpdatePrompt";

const DISMISSED_UPDATE_KEY = "yich-dismissed-update-version";

export function AppUpdateLayer() {
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    const handleUpdateAvailable = (event: Event) => {
      const info = appUpdateInfoFromEvent(event);
      if (!info) return;
      if (readDismissedVersion() === info.serverVersion) return;
      setUpdateInfo(info);
    };

    window.addEventListener(APP_UPDATE_AVAILABLE_EVENT, handleUpdateAvailable);
    return () => window.removeEventListener(APP_UPDATE_AVAILABLE_EVENT, handleUpdateAvailable);
  }, []);

  if (!updateInfo) return null;

  const dismiss = () => {
    writeDismissedVersion(updateInfo.serverVersion);
    dismissAppUpdatePrompt(updateInfo.serverVersion);
    setUpdateInfo(null);
  };

  const update = () => {
    setUpdating(true);
    void reloadForAppUpdate(updateInfo.serverVersion);
  };

  return <AppUpdatePrompt info={updateInfo} updating={updating} onDismiss={dismiss} onUpdate={update} />;
}

function readDismissedVersion() {
  try {
    return window.sessionStorage.getItem(DISMISSED_UPDATE_KEY);
  } catch {
    return null;
  }
}

function writeDismissedVersion(version: string) {
  try {
    window.sessionStorage.setItem(DISMISSED_UPDATE_KEY, version);
  } catch {
    // A blocked sessionStorage should not prevent the user from continuing.
  }
}

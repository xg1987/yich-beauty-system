import { MonitorDown, X } from "lucide-react";
import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const DISMISSED_KEY = "yich-pwa-install-dismissed";

function isStandaloneDisplay() {
  return window.matchMedia("(display-mode: standalone)").matches
    || window.matchMedia("(display-mode: window-controls-overlay)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export default function PwaInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || isStandaloneDisplay()) return;

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      if (window.sessionStorage.getItem(DISMISSED_KEY) === "1") return;
      setInstallEvent(event as BeforeInstallPromptEvent);
      setVisible(true);
    };

    const onAppInstalled = () => {
      setVisible(false);
      setInstallEvent(null);
      window.sessionStorage.removeItem(DISMISSED_KEY);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  if (!visible || !installEvent) return null;

  const install = async () => {
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === "accepted") {
      setVisible(false);
      setInstallEvent(null);
    }
  };

  const dismiss = () => {
    window.sessionStorage.setItem(DISMISSED_KEY, "1");
    setVisible(false);
  };

  return (
    <div className="pwa-install-prompt" role="region" aria-label="安装桌面应用">
      <button type="button" className="pwa-install-action" onClick={() => void install()}>
        <MonitorDown size={18} />
        <span>安装到电脑</span>
      </button>
      <button type="button" className="pwa-install-dismiss" aria-label="暂不安装" onClick={dismiss}>
        <X size={16} />
      </button>
    </div>
  );
}

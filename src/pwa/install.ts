/**
 * Optional 「加到主畫面」. Browsers that fire beforeinstallprompt keep the
 * event; others get a short how-to toast from the caller.
 */

export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;

export function initPwaInstall(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferred = null;
  });
}

export function canPromptInstall(): boolean {
  return !!deferred && !installed;
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches
    || ("standalone" in navigator && Boolean((navigator as { standalone?: boolean }).standalone));
}

export async function promptInstall(): Promise<InstallOutcome> {
  if (!deferred) return "unavailable";
  const ev = deferred;
  try {
    await ev.prompt();
    const choice = await ev.userChoice;
    if (choice.outcome === "accepted") deferred = null;
    return choice.outcome;
  } catch {
    return "unavailable";
  }
}

export function installHowTo(): string {
  return "在瀏覽器選單選「加到主畫面」或「安裝應用程式」。第一次開啟後，離線也能開上次的場佈。";
}

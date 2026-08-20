import "./style.css";
import { App } from "./app/App";
import { UI } from "./ui/UI";
import { Store } from "./state/store";
import { createDefaultProject } from "./core/model";

const canvas = document.getElementById("scene");
const root = document.getElementById("app");
if (!(canvas instanceof HTMLCanvasElement) || !root) {
  throw new Error("app root not found");
}

const { project: restored, recovered } = Store.loadAutosaveWithRecovery();
const store = new Store(restored ?? createDefaultProject());
const app = new App(canvas, store);
const ui = new UI(app, root);

if (recovered) {
  app.notifyToast?.("無法讀取上次專案，已建立安全備份並開新專案", false);
}
store.onStorageError = () => {
  app.notifyToast?.("儲存空間不足，最近的變更可能沒有存下來", false);
};

// Flush the debounced autosave when the tab is backgrounded or closed so the
// last edit before leaving is never lost.
window.addEventListener("pagehide", () => store.flushAutosave());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") store.flushAutosave();
});

// Dev-only handle for automated/browser testing (not bundled in production).
if (import.meta.env.DEV) {
  (window as unknown as { planform?: unknown }).planform = {
    app,
    ui,
    store,
    workspace: () => ui.workspace,
    catalog: () => app.getCatalog(),
    agent: app.quickAgent,
  };
}

// PWA service worker with an explicit update affordance: a stale client shows
// a banner instead of silently running old code forever.
if (import.meta.env.PROD) {
  void import("virtual:pwa-register").then(({ registerSW }) => {
    const updateSW = registerSW({
      onNeedRefresh() {
        showUpdateBanner(() => void updateSW(true));
      },
    });
  });
}

function showUpdateBanner(onUpdate: () => void): void {
  if (document.querySelector(".update-banner")) return;
  const banner = document.createElement("div");
  banner.className = "update-banner";
  const label = document.createElement("span");
  label.textContent = "有新版本可以使用";
  const btn = document.createElement("button");
  btn.textContent = "立即更新";
  btn.className = "chip chip--accent";
  btn.addEventListener("click", () => {
    store.flushAutosave();
    onUpdate();
  });
  const later = document.createElement("button");
  later.textContent = "稍後";
  later.className = "chip chip--sm";
  later.addEventListener("click", () => banner.remove());
  banner.append(label, btn, later);
  root?.append(banner);
}

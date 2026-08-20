import "./style.css";
import { App } from "./app/App";
import { UI } from "./ui/UI";
import { Store } from "./state/store";
import { createDefaultProject } from "./core/model";
import { exportProjectJson } from "./export/exporters";

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
let autosaveBanner: HTMLElement | null = null;
store.onStorageError = () => {
  if (autosaveBanner) return;
  autosaveBanner = document.createElement("div");
  autosaveBanner.className = "update-banner autosave-error";
  const label = document.createElement("span");
  label.textContent = "自動儲存失敗，最近的修改可能尚未保存";
  const exportBtn = document.createElement("button");
  exportBtn.className = "chip chip--accent";
  exportBtn.textContent = "匯出 JSON";
  exportBtn.addEventListener("click", () => exportProjectJson(store.getState()));
  autosaveBanner.append(label, exportBtn);
  root.append(autosaveBanner);
};
store.onStorageRecovered = () => {
  autosaveBanner?.remove();
  autosaveBanner = null;
};

// Flush the debounced autosave when the tab is backgrounded or closed so the
// last edit before leaving is never lost.
window.addEventListener("pagehide", () => store.flushAutosave());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") store.flushAutosave();
});

// Browser-test handle: always on in dev (dev builds never ship, and the
// whole e2e suite depends on it), opt-in via ?e2e on a production bundle.
const e2eEnabled =
  import.meta.env.DEV ||
  new URLSearchParams(location.search).has("e2e") ||
  import.meta.env.VITE_E2E === "true";
if (e2eEnabled) {
  (window as unknown as { planform?: unknown }).planform = {
    app,
    ui,
    store,
    workspace: () => ui.workspace,
    catalog: () => app.getCatalog(),
    agent: app.quickAgent,
    showUpdateBanner: () => showUpdateBanner(() => undefined),
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
      onRegisteredSW(_swUrl, registration) {
        if (!registration) return;
        const check = () => void registration.update();
        window.setInterval(check, 60 * 60 * 1000);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") check();
        });
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

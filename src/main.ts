import "./style.css";
import { App } from "./app/App";
import { UI } from "./ui/UI";
import { Store } from "./state/store";
import { ProjectRepository } from "./state/projectRepository";
import { createDefaultProject } from "./core/model";
import { exportProjectJson } from "./export/exporters";

const canvas = document.getElementById("scene");
const root = document.getElementById("app");
if (!(canvas instanceof HTMLCanvasElement) || !root) {
  throw new Error("app root not found");
}

// One-time import of the pre-multi-project world: the old single autosave
// becomes a real project so nobody opens the app to an empty list. The legacy
// keys are read, never deleted.
const migrated = ProjectRepository.migrateLegacyIfNeeded();

// Resume the project that was open, if it still opens. A body that has gone
// corrupt must land the user on Project Home with an explanation rather than
// on a white screen.
const activeId = ProjectRepository.getActiveProjectId();
const opened = activeId ? ProjectRepository.openProject(activeId) : null;
const store = new Store(opened?.ok ? opened.project : createDefaultProject());
if (opened?.ok && activeId) store.bindProject(activeId);
else ProjectRepository.setActiveProjectId(null);

const app = new App(canvas, store);
// A resumed plan must arrive with its own numbers. Opening and creating both
// seed the session; resuming skipped it, so a refresh silently swapped the
// plan's authored arrival rhythm, window and staffing for the class defaults —
// and the next ▶ 模擬 wrote those defaults back to disk.
if (opened?.ok) app.seedSessionFromPlan(store.getState());
const ui = new UI(app, root);

if (opened && !opened.ok) {
  app.notifyToast?.("上次開著的專案讀不出來，已回到「我的專案」", false);
} else if (migrated) {
  app.notifyToast?.(`舊的場佈已存成專案「${migrated.name}」`, false);
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

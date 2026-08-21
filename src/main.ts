import "./style.css";
import { App } from "./app/App";
import { UI } from "./ui/UI";
import { Store } from "./state/store";
import { createDefaultProject } from "./core/model";
import { NULL_PERSISTENCE, ProjectRepository } from "./state/projectRepository";
import { ProjectSession } from "./state/projectSession";
import { exportProjectJson } from "./export/exporters";

const canvas = document.getElementById("scene");
const root = document.getElementById("app");
if (!(canvas instanceof HTMLCanvasElement) || !root) {
  throw new Error("app root not found");
}

// Boot order is load-bearing. The Store starts on the no-op sink so nothing
// can write over the retained pre-library autosave before the migration has
// read it; `bootstrap()` then runs the migration, picks the first screen and
// hydrates the Store — all before `new UI`, because UI reads the open project
// while it builds. `onProjectOpened` is wired first so the boot hydrate is
// adopted like any other.
const store = new Store(createDefaultProject());
store.setPersistence(NULL_PERSISTENCE);
const repo = new ProjectRepository();
const projects = new ProjectSession(store, repo);
const app = new App(canvas, store, projects);

projects.onProjectOpened = (project, ctx) => app.adoptProject(project, { frame: ctx.interactive });
const boot = projects.bootstrap();

const ui = new UI(app, root);
projects.onScreenChange = (screen) => ui.setScreen(screen);
projects.onLibraryChange = () => ui.refreshProjectHome();
projects.onToast = (msg, undo) => ui.showToast(msg, undo);
ui.setScreen(boot.screen);

// Index and variant failures are reported here, never through the Store's
// autosave latch: that latch answers one question only — can I persist the
// project that is open? — and the 自動儲存失敗 banner below claims exactly that.
repo.onError = (op) => {
  app.notifyToast?.(
    op === "index" ? "專案清單儲存失敗，可能是儲存空間已滿" : "這版場佈儲存失敗，原本的排法仍保留",
    false,
  );
};

if (boot.recovered) {
  app.notifyToast?.("有專案讀不出來，原始資料已保留在「我的專案」裡", false);
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
// Cross-tab: another tab may have created, renamed or deleted a project.
// `listProjects()` reads the index from disk on every call, so re-rendering is
// the entire fix.
window.addEventListener("storage", (e) => {
  if (e.key?.startsWith("planform-iso:")) ui.refreshProjectHome();
});

window.addEventListener("pagehide", () => projects.flush());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") projects.flush();
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
    projects,
    repo,
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
    projects.flush();
    onUpdate();
  });
  const later = document.createElement("button");
  later.textContent = "稍後";
  later.className = "chip chip--sm";
  later.addEventListener("click", () => banner.remove());
  banner.append(label, btn, later);
  root?.append(banner);
}

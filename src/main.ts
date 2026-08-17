import "./style.css";
import { App } from "./app/App";
import { UI } from "./ui/UI";
import { Store, migrate } from "./state/store";
import { createDefaultProject } from "./core/model";
import { readSharedFromHash } from "./share/share";

const canvas = document.getElementById("scene");
const root = document.getElementById("app");
if (!(canvas instanceof HTMLCanvasElement) || !root) {
  throw new Error("app root not found");
}

// A shared link (#p=...) takes precedence over the local autosave.
const shared = readSharedFromHash(location.hash);
const initial = shared ? migrate(shared) : (Store.loadAutosave() ?? createDefaultProject());
if (shared) {
  // Drop the hash so later edits/refreshes use the local copy, not the stale link.
  history.replaceState(null, "", `${location.pathname}${location.search}`);
}

const store = new Store(initial);
const app = new App(canvas, store);
new UI(app, root);

// Register the PWA service worker (production only).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  });
}

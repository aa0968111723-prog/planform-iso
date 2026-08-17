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

const restored = Store.loadAutosave();
const store = new Store(restored ?? createDefaultProject());
const app = new App(canvas, store);
new UI(app, root);

// Register the PWA service worker (production only).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  });
}

import type { App } from "../app/App";
import { CATALOG_CATEGORIES } from "../core/assets";
import type { AssetCatalogEntry, CatalogCategory } from "../core/catalog";
import { ZONE_DEFAULTS, type ZoneType } from "../core/model";
import { metersToCm } from "../core/units";
import { button, card, el } from "./dom";

const PLACEMENT_LABEL: Record<string, string> = { floor: "地面", wall: "牆面", tabletop: "桌面" };

export interface LibraryOptions {
  categories?: CatalogCategory[];
  zones?: boolean;
  arrays?: boolean;
}

/** Left "what do I want to place?" library: category tabs + compact cards. */
export function buildLibrary(app: App, opts: LibraryOptions = {}): HTMLElement {
  const cats = opts.categories ?? CATALOG_CATEGORIES.map((c) => c.id);
  const root = el("div", { class: "library" });
  const catalog = app.getCatalog();
  const panels: { label: string; body: HTMLElement }[] = [];

  const recent = catalog.listRecent();
  if (recent.length) {
    panels.push({
      label: "常用",
      body: el("div", { class: "cardgrid" }, recent.map((e) => catalogCard(app, e))),
    });
  }

  if (opts.zones) {
    panels.push({
      label: "區域",
      body: el("div", { class: "cardgrid" }, (Object.keys(ZONE_DEFAULTS) as ZoneType[]).map((z) =>
        card(ZONE_DEFAULTS[z].icon, ZONE_DEFAULTS[z].label, "區域", () => app.addZone(z)))),
    });
  }

  for (const c of CATALOG_CATEGORIES) {
    if (!cats.includes(c.id)) continue;
    const defs = catalog.list({ category: c.id });
    if (!defs.length) continue;
    panels.push({
      label: c.label,
      body: el("div", { class: "cardgrid" }, defs.map((d) => catalogCard(app, d))),
    });
  }

  if (opts.arrays) {
    panels.push({
      label: "排列",
      body: el("div", { class: "cardgrid" }, [
        card("🟪", "地墊陣列", "整組地墊", () => app.createArray("mat")),
        card("💺", "椅子陣列", "整組椅子", () => app.createArray("chair")),
      ]),
    });
  }
  if (panels.length === 0) return root;

  const bodies = panels.map((p) => el("div", { class: "libpanel" }, [p.body]));
  const tabs = el("div", { class: "libtabs" }, panels.map((p, i) =>
    button(p.label, () => show(i), "chip chip--sm libtab")));
  const show = (idx: number) => {
    bodies.forEach((b, i) => (b.style.display = i === idx ? "" : "none"));
    tabs.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-pressed", String(i === idx)));
  };
  root.append(el("div", { class: "subhead", text: "素材庫" }), tabs, ...bodies);
  show(0);
  return root;
}

function catalogCard(app: App, d: AssetCatalogEntry): HTMLButtonElement {
  const w = Math.round(metersToCm(d.dimensions.width));
  const dep = Math.round(metersToCm(d.dimensions.depth));
  const role = d.serviceRole && d.serviceRole !== "none" ? ` · ${d.serviceRole}` : "";
  const c = card(
    d.icon,
    d.name,
    `${w}×${dep}cm · ${PLACEMENT_LABEL[d.placementType] ?? ""}${role}`,
    () => app.beginPlacementByAssetId(d.id),
  );
  c.dataset.name = d.name.toLowerCase();
  return c;
}

/** Compact placement-mode toolbar shown while placing. */
export function buildPlacementToolbar(app: App): HTMLElement {
  return el("div", { class: "placebar" }, [
    el("span", { class: "placebar__hint", text: "點擊放置 · 可連續放置" }),
    button("旋轉 / 換向", () => app.rotateGhost(), "chip"),
    button("完成", () => app.cancelPlacement(), "chip chip--primary"),
  ]);
}

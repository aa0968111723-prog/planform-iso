import type { App } from "../app/App";
import { ASSET_CATEGORIES, assetsByCategory, type AssetCategory, type AssetDefinition } from "../core/assets";
import { ZONE_DEFAULTS, type ZoneType } from "../core/model";
import { metersToCm } from "../core/units";
import { button, card, el } from "./dom";

const PLACEMENT_LABEL: Record<string, string> = { floor: "地面", wall: "牆面", tabletop: "桌面" };

export interface LibraryOptions {
  categories?: AssetCategory[];
  zones?: boolean;
  arrays?: boolean;
}

/** Left "what do I want to place?" library: category tabs + compact cards. */
export function buildLibrary(app: App, opts: LibraryOptions = {}): HTMLElement {
  const cats = opts.categories ?? ASSET_CATEGORIES.map((c) => c.id);
  const root = el("div", { class: "library" });

  const panels: { label: string; body: HTMLElement }[] = [];
  if (opts.zones) {
    panels.push({ label: "區域", body: el("div", { class: "cardgrid" }, (Object.keys(ZONE_DEFAULTS) as ZoneType[]).map((z) => card(ZONE_DEFAULTS[z].icon, ZONE_DEFAULTS[z].label, "區域", () => app.addZone(z)))) });
  }
  for (const c of ASSET_CATEGORIES) {
    if (!cats.includes(c.id)) continue;
    const defs = assetsByCategory(c.id);
    panels.push({ label: c.label, body: el("div", { class: "cardgrid" }, defs.map((d) => assetCard(app, d))) });
  }
  if (opts.arrays) {
    panels.push({ label: "排列", body: el("div", { class: "cardgrid" }, [
      card("🟪", "地墊陣列", "整組地墊", () => app.createArray("mat")),
      card("💺", "椅子陣列", "整組椅子", () => app.createArray("chair")),
    ]) });
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

function assetCard(app: App, d: AssetDefinition): HTMLButtonElement {
  const w = Math.round(metersToCm(d.defaultDimensions.width));
  const dep = Math.round(metersToCm(d.defaultDimensions.depth));
  const c = card(d.icon, d.displayName, `${w}×${dep}cm · ${PLACEMENT_LABEL[d.placementType]}`, () => app.beginPlacement(d.kind));
  c.dataset.name = d.displayName.toLowerCase();
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

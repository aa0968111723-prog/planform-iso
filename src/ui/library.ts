import type { App } from "../app/App";
import { ASSET_CATEGORIES, assetsByCategory, type AssetCategory, type AssetDefinition } from "../core/assets";
import { ZONE_DEFAULTS, type ZoneType } from "../core/model";
import { metersToCm } from "../core/units";
import { button, card, el, section } from "./dom";

const PLACEMENT_LABEL: Record<string, string> = { floor: "地面", wall: "牆面", tabletop: "桌面" };

export interface LibraryOptions {
  categories?: AssetCategory[];
  zones?: boolean;
  arrays?: boolean;
}

/** Left "what do I want to place?" library: cards by category, with search. */
export function buildLibrary(app: App, opts: LibraryOptions = {}): HTMLElement {
  const cats = opts.categories ?? ASSET_CATEGORIES.map((c) => c.id);
  const root = el("div", { class: "library" });
  const search = el("input", { type: "search", placeholder: "搜尋素材…", class: "field__input" }) as HTMLInputElement;
  root.append(el("label", { class: "field" }, [el("span", { class: "field__label", text: "素材庫" }), search]));

  if (opts.zones) {
    root.append(section("功能區域", [
      el("div", { class: "cardgrid" },
        (Object.keys(ZONE_DEFAULTS) as ZoneType[]).map((z) => card("▨", ZONE_DEFAULTS[z].label, "區域", () => app.addZone(z)))),
    ]));
  }

  for (const c of ASSET_CATEGORIES) {
    if (!cats.includes(c.id)) continue;
    const defs = assetsByCategory(c.id);
    root.append(section(c.label, [el("div", { class: "cardgrid" }, defs.map((d) => assetCard(app, d)))]));
  }

  if (opts.arrays) {
    root.append(section("排列（整組）", [
      el("p", { class: "hint", text: "建立可整組調整行列與間距的陣列。" }),
      el("div", { class: "cardgrid" }, [
        card("🟪", "地墊陣列", "整組地墊", () => app.createArray("mat")),
        card("💺", "椅子陣列", "整組椅子", () => app.createArray("chair")),
      ]),
    ]));
  }

  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    root.querySelectorAll<HTMLButtonElement>(".card").forEach((c) => {
      const name = c.dataset.name ?? "";
      c.style.display = q && !name.includes(q) ? "none" : "";
    });
  });
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

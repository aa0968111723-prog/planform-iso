import type { App } from "../app/App";
import { CATALOG_CATEGORIES } from "../core/assets";
import type { AssetCatalogEntry, CatalogCategory } from "../core/catalog";
import { BOOTH_ZONE_ROLES, BOOTH_ZONE_ROLE_IDS } from "../core/boothCatalog";
import { planSymbolForEntry, renderPlanThumbDataUrl } from "../core/planSymbol";
import { ZONE_DEFAULTS, type ZoneType } from "../core/model";
import { metersToCm } from "../core/units";
import { button, card, el } from "./dom";

const PLACEMENT_LABEL: Record<string, string> = { floor: "地面", wall: "牆面", tabletop: "桌面" };
const ROLE_LABEL: Record<string, string> = { checkin: "報到", payment: "收費", guidance: "引導", storage: "收納" };

/** 常用物資 — the supplies a zen-club event actually uses, front and center. */
const COMMON_SUPPLY_IDS = [
  "builtin:mat",
  "builtin:chair",
  "builtin:table",
  "builtin:regTable",
  "builtin:payment-desk",
  "builtin:computer",
  "builtin:door",
  "builtin:screen",
  "builtin:shoe-rack",
  "builtin:signage-stand",
  "builtin:queue-barrier",
];

export interface LibraryOptions {
  categories?: CatalogCategory[];
  zones?: boolean;
  arrays?: boolean;
  /**
   * Fired after a card starts a placement / creates an entity. Compact layouts
   * use it to collapse the sheet so the user lands straight on the canvas.
   */
  onPick?: () => void;
}

/** Left "what do I want to place?" library: category tabs + compact cards. */
export function buildLibrary(app: App, opts: LibraryOptions = {}): HTMLElement {
  const cats = opts.categories ?? CATALOG_CATEGORIES.map((c) => c.id);
  const root = el("div", { class: "library" });
  const catalog = app.getCatalog();
  const panels: { label: string; body: HTMLElement }[] = [];
  const pick = (run: () => void) => () => { run(); opts.onPick?.(); };

  // 常用物資 only belongs on the main 場佈 library; a narrow library
  // (e.g. 場地 → 固定設施) must not surface mats and desks.
  const common = opts.categories && !opts.zones
    ? []
    : COMMON_SUPPLY_IDS
        .map((id) => catalog.get(id))
        .filter((e): e is AssetCatalogEntry => !!e);
  if (common.length) {
    panels.push({
      label: "常用物資",
      body: el("div", { class: "cardgrid" }, common.map((e) => catalogCard(app, e, opts))),
    });
  }

  if (opts.zones) {
    // A booth plan speaks in 工作人員區 / 排隊區 / 入口, not 報到區 / 收費區.
    // Its zones drop straight into the middle of the pitch (the tap-to-place
    // flow is for room-sized layouts), so they get their own panel.
    const boothZones = app.isBoothPlan()
      ? BOOTH_ZONE_ROLE_IDS.map((role) =>
          card(BOOTH_ZONE_ROLES[role].icon, BOOTH_ZONE_ROLES[role].label, "加到攤位中央後拖曳",
            pick(() => app.addBoothZone(role))))
      : [];
    panels.push({
      label: "區域",
      body: el("div", { class: "cardgrid" }, [
        ...boothZones,
        ...(Object.keys(ZONE_DEFAULTS) as ZoneType[]).map((z) =>
          card(ZONE_DEFAULTS[z].icon, ZONE_DEFAULTS[z].label, "點畫面放置", pick(() => app.beginZonePlacement(z)))),
      ]),
    });
  }

  const recent = catalog.listRecent().filter((e) => !COMMON_SUPPLY_IDS.includes(e.id));
  if (recent.length) {
    panels.push({
      label: "最近",
      body: el("div", { class: "cardgrid" }, recent.map((e) => catalogCard(app, e, opts))),
    });
  }

  for (const c of CATALOG_CATEGORIES) {
    if (!cats.includes(c.id)) continue;
    const defs = catalog.list({ category: c.id });
    if (!defs.length) continue;
    panels.push({
      label: c.label,
      body: el("div", { class: "cardgrid" }, defs.map((d) => catalogCard(app, d, opts))),
    });
  }

  if (opts.arrays) {
    panels.push({
      label: "排列",
      body: el("div", { class: "cardgrid" }, [
        // 🧩, matching the catalog entry and the measured teal the mats render
        // in. A purple swatch next to a green object is the same mistake the
        // pixel measurement was done to end, in miniature.
        card("🧩", "地墊陣列", "整組地墊", pick(() => app.createArray("mat"))),
        card("💺", "椅子陣列", "整組椅子", pick(() => app.createArray("chair"))),
      ]),
    });
  }
  if (panels.length === 0) return root;

  // One scrolling panel per category keeps the sheet a fixed, predictable
  // height instead of growing into an endless catalogue page.
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

/** 2D plan-symbol thumbnail; falls back to the emoji glyph when unavailable. */
function thumbFor(d: AssetCatalogEntry): string | null {
  if (d.placementType !== "floor") return null;
  try {
    return renderPlanThumbDataUrl(planSymbolForEntry(d), 64);
  } catch {
    return null;
  }
}

function catalogCard(app: App, d: AssetCatalogEntry, opts: LibraryOptions = {}): HTMLButtonElement {
  const w = Math.round(metersToCm(d.dimensions.width));
  const dep = Math.round(metersToCm(d.dimensions.depth));
  const role = d.serviceRole && d.serviceRole !== "none" && ROLE_LABEL[d.serviceRole]
    ? ` · ${ROLE_LABEL[d.serviceRole]}`
    : "";
  const c = card(
    d.icon,
    d.name,
    `${w}×${dep}cm · ${PLACEMENT_LABEL[d.placementType] ?? ""}${role}`,
    () => { app.beginPlacementByAssetId(d.id); opts.onPick?.(); },
  );
  const thumb = thumbFor(d);
  if (thumb) {
    const iconSpan = c.querySelector(".card__icon");
    if (iconSpan) {
      iconSpan.textContent = "";
      iconSpan.append(el("img", { class: "card__thumb", src: thumb, alt: d.name }));
    }
  }
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

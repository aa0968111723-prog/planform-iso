import type { App } from "../app/App";
import { CATALOG_CATEGORIES } from "../core/assets";
import type { AssetCatalogEntry, CatalogCategory } from "../core/catalog";
import { BOOTH_ZONE_ROLES, BOOTH_ZONE_ROLE_IDS } from "../core/boothCatalog";
import { BOOTH_PROP_PRESETS } from "../core/boothPropPresets";
import { isUserMadeProp } from "../core/propDraft";
import { propEntryId } from "../core/propCatalog";
import { planSymbolForEntry, renderPlanThumbDataUrl } from "../core/planSymbol";
import { listLibraryProps, loadLibraryProp } from "../state/propLibrary";
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

  // Always offered: a classroom plan still needs a 招生桌, and burying these
  // behind 「＋ 新增道具」 meant nobody could find a QR 立架.
  if (!opts.categories || opts.zones) {
    panels.push({
      label: "桌面佈置",
      body: el("div", {}, [
        el("p", { class: "hint", text: "先選一張桌子，再進入桌面佈置；素材都收在「攤位道具」，避免同一個小物重複出現。" }),
        el("div", { class: "cardgrid" }, [
          (() => { const badge = card("●", "自訂胸針", "上傳圖案後模擬桌面擺放", pick(() => app.openNewPropStudio("badge"))); badge.dataset.name = "胸針 badge"; return badge; })(),
          card("⌗", "進入桌面佈置", "選取桌子後放大編排", pick(() => app.enterTabletopLayout())),
        ]),
      ]),
    });
    const groups = [
      { label: "文宣", items: BOOTH_PROP_PRESETS.filter((p) => p.category === "文宣") },
      { label: "擺攤小物", items: BOOTH_PROP_PRESETS.filter((p) => p.category === "擺攤小物") },
      { label: "背景", items: BOOTH_PROP_PRESETS.filter((p) => p.category === "背景") },
    ];
    const mine = userMadePropCards(app, opts);
    panels.push({
      label: "攤位道具",
      body: el("div", {}, [
        el("div", { class: "subhead", text: "新增自訂素材" }),
        el("div", { class: "cardgrid" }, [selfMakeCard(app, opts)]),
        ...(mine.length ? [
          el("div", { class: "subhead", text: "我做的" }),
          el("div", { class: "cardgrid" }, mine),
        ] : []),
        ...groups.map((g) => el("div", {}, [
          el("div", { class: "subhead", text: g.label }),
          el("div", { class: "cardgrid" }, g.items.map((p) => boothPropCard(app, p, opts))),
        ])),
      ]),
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
  const search = el("input", { type: "search", class: "field__input", placeholder: "搜尋茶壺、QR、傳單、骰子…" }) as HTMLInputElement;
  search.addEventListener("input", () => {
    const query = search.value.trim().toLowerCase();
    root.querySelectorAll<HTMLElement>("[data-name]").forEach((node) => {
      const name = node.dataset.name ?? "";
      node.style.display = !query || name.includes(query) ? "" : "none";
    });
    // A search should not leave the only match behind an inactive tab.
    if (query) bodies.forEach((body) => { body.style.display = ""; });
  });
  root.append(el("div", { class: "subhead", text: "素材庫" }), search, tabs, ...bodies);
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

function selfMakeCard(app: App, opts: LibraryOptions = {}): HTMLButtonElement {
  const c = card("＋", "自己做", "自己定尺寸、顏色、貼圖", () => {
    app.openNewPropStudio("tabletop");
    opts.onPick?.();
  });
  c.dataset.name = "自己做";
  return c;
}

function userMadePropCards(app: App, opts: LibraryOptions = {}): HTMLButtonElement[] {
  const cards: HTMLButtonElement[] = [];
  const seen = new Set<string>();
  for (const def of app.propDefinitions().filter(isUserMadeProp)) {
    seen.add(def.id);
    cards.push(userPropCard(def, () => {
      app.beginPlacementByAssetId(propEntryId(def));
      opts.onPick?.();
    }));
  }
  for (const meta of listLibraryProps()) {
    if (seen.has(meta.id)) continue;
    const def = loadLibraryProp(meta.id);
    if (!def || !isUserMadeProp(def)) continue;
    cards.push(userPropCard(def, () => {
      app.addPropToProject(def, { place: true });
      opts.onPick?.();
    }));
  }
  return cards;
}

function userPropCard(
  def: { name: string; icon?: string; placement?: "floor" | "tabletop"; dimensions: { width: number; depth: number } },
  onClick: () => void,
): HTMLButtonElement {
  const w = Math.round(metersToCm(def.dimensions.width));
  const dep = Math.round(metersToCm(def.dimensions.depth));
  const place = def.placement === "tabletop" ? "桌面" : "地面";
  const c = card(def.icon ?? "✦", def.name, `${w}×${dep}cm · ${place}`, onClick);
  c.dataset.name = def.name.toLowerCase();
  return c;
}

function boothPropCard(app: App, def: (typeof BOOTH_PROP_PRESETS)[number], opts: LibraryOptions = {}): HTMLButtonElement {
  const w = Math.round(metersToCm(def.dimensions.width));
  const dep = Math.round(metersToCm(def.dimensions.depth));
  const place = def.placement === "tabletop" ? "桌面" : "地面";
  const c = card(
    def.icon ?? "▦",
    def.name,
    `${w}×${dep}cm · ${place}`,
    () => { app.placeBoothProp(def.id); opts.onPick?.(); },
  );
  c.dataset.name = def.name.toLowerCase();
  return c;
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

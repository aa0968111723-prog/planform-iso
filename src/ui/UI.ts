import { App, type Workflow } from "../app/App";
import { metersToCm, type SnapMode } from "../core/units";
import { calibrationPendingLabels, type MeasurementType, type RouteType, type ViewName } from "../core/model";
import { calibrationCompare } from "../core/measure";
import { ROUTE_PRESETS } from "../core/routes";
import { issueCounts, type Severity } from "../core/validation";
import { dockingPolicy, type WorkspaceMode } from "../core/viewport";
import { renderConstructionPlan, type PageOrientation, type PageSize, type PlanOptions, type PlanPreset, type RoleFilter } from "../export/constructionPlan";
import { downloadPng, exportProjectJson, importProjectJson, pngFilename, sharePng } from "../export/exporters";
import { buildInspector } from "./inspector";
import { buildLibrary, buildPlacementToolbar } from "./library";
import { buildQuickAgentSheet, type QuickAgentSheetHandles } from "./quickAgentSheet";
import { buildCustomAssetFlow } from "./customAssetFlow";
import { buildVenueCaptureFlow } from "./venueCapture";
import { refreshSimPanel } from "./simPanel";
import { buildMenuSheet, type MenuGroup, type MenuSheetHandles } from "./menuSheet";
import { renderContextBar } from "./contextBar";
import { buildPartnerMode, type PartnerModeHandles } from "./partnerMode";
import { quickStartSeen, showQuickStart } from "./quickStart";
import { BUILD_INFO } from "../buildInfo";
import { BUILTIN_VENUE_PRESETS, deleteUserVenuePreset, listUserVenuePresets } from "../core/venues";
import { Store } from "../state/store";
import { WorkspaceViewport, type WorkspaceViewportState } from "./workspaceViewport";
import { button, el, num, section, selectField, textField } from "./dom";

const VIEWS: { id: ViewName; label: string }[] = [
  { id: "top", label: "俯視" }, { id: "iso", label: "立體" }, { id: "front", label: "正視" },
  { id: "left", label: "左視" }, { id: "right", label: "右視" },
];
const SNAPS: { id: SnapMode; label: string }[] = [
  { id: "off", label: "自由" }, { id: "intersection", label: "交點" }, { id: "edge", label: "邊線" },
  { id: "center", label: "中心" }, { id: "half", label: "半格" },
];
const WORKFLOWS: { id: Workflow; label: string; icon: string }[] = [
  { id: "site", label: "場地", icon: "▦" }, { id: "layout", label: "場佈", icon: "▤" },
  { id: "route", label: "動線", icon: "↝" }, { id: "check", label: "檢查", icon: "✓" },
  { id: "export", label: "分享", icon: "↗" },
];
const SEV_LABEL: Record<Severity, string> = { error: "錯誤", warning: "警告", info: "建議" };
const SEV_ICON: Record<Severity, string> = { error: "⛔", warning: "⚠", info: "ℹ" };

/** Which sheet, if any, currently covers part of the canvas on a compact layout. */
type SheetKind = "none" | "workflow" | "inspector";

export class UI {
  private topbar = el("header", { class: "topbar" });
  private left = el("aside", { class: "left" });
  private right = el("aside", { class: "right" });
  private nav = el("nav", { class: "bottomnav" });
  private placebar = el("div", { class: "placebar-wrap", style: "display:none" });
  private measurebar = el("div", { class: "measurebar", style: "display:none" });
  private box = el("div", { class: "boxsel", style: "display:none" });
  private toast = el("div", { class: "toast", style: "display:none" });
  private partner: PartnerModeHandles;
  private ctxbar = el("div", { class: "ctxbar", style: "display:none" });
  private advanced = false;
  private lastWorkflow: Workflow | null = null;
  private lastMode: Mode | null = null;
  private snapSel: HTMLSelectElement | null = null;
  private toastTimer: number | null = null;
  private planOpts = { preset: "full" as PlanPreset, page: "a4" as PageSize, orientation: "landscape" as PageOrientation, dims: false, inventory: true, simplify: false };
  private agentSheet: QuickAgentSheetHandles;
  private menu: MenuSheetHandles = buildMenuSheet();
  private smartBox = el("div", { class: "list" });
  private simPanelRoot = el("div", { class: "sim-panel-host" });
  private participants = 30;
  private sheet: SheetKind = "none";
  private placebarKind: "place" | "route" | null = null;
  private sheetDetent: "collapsed" | "half" | "full" = "half";
  private sheetHistoryPushed = false;
  private viewport: WorkspaceViewport;
  private mode: WorkspaceMode = "desktop";
  private builtHeaderMode: WorkspaceMode | null = null;

  constructor(private app: App, private root: HTMLElement) {
    this.partner = buildPartnerMode(app, {
      onExit: () => this.app.exitPartnerMode(),
      onLayoutChange: () => this.viewport.schedule(),
    });
    root.append(
      this.topbar, this.left, this.right, this.nav, this.placebar, this.measurebar,
      this.box, this.toast, this.ctxbar, this.menu.root,
      this.partner.top, this.partner.dock, this.partner.sheet,
    );
    this.agentSheet = buildQuickAgentSheet(app, {
      openMatArranger: () => {
        this.app.setWorkflow("layout");
        this.setSheet("workflow");
        this.app.computeMatCandidates(this.app.session.participants, this.matOpts());
        this.update();
      },
      startEntryRoute: () => {
        this.app.setWorkflow("route");
        this.app.newRoutePreset("entry");
        if (this.compact) this.setSheet("none");
        this.showToast("點畫面新增動線節點，畫完按「完成繪製」");
      },
      openCheck: () => {
        this.app.setWorkflow("check");
        this.setSheet("workflow");
      },
      sharePartnerImage: () => {
        const state = this.app.store.getState();
        const dataUrl = renderConstructionPlan(state, { preset: "partner", simplify: true, dims: false });
        void sharePng(dataUrl, pngFilename(state.name, "夥伴觀看圖")).then((how) => {
          if (how !== "cancelled") this.showToast(how === "shared" ? "已開啟分享（可直接傳 LINE）" : "圖片已下載");
        });
      },
    });
    root.append(this.agentSheet.root);

    this.viewport = new WorkspaceViewport(root, app.scene.domElement);
    this.viewport.registerChrome({
      header: [this.topbar, this.partner.top],
      nav: [this.nav, this.partner.dock],
      left: this.left,
      right: this.right,
      sheets: [this.partner.sheet],
      bars: [this.ctxbar, this.placebar, this.measurebar, this.agentSheet.root],
    });
    this.viewport.start();
    this.viewport.subscribe((state) => {
      this.mode = state.mode;
      // Everything that frames the world uses the measured visible rect, so the
      // camera never assumes the whole window is canvas.
      this.app.scene.setViewportRects(state.canvas, state.safeRect, state.focusRect);
      this.onModeMaybeChanged();
    });

    this.buildNav();
    this.placebar.append(buildPlacementToolbar(app));
    this.app.onBox = (rect) => this.renderBox(rect);
    this.app.onToast = (msg, undo) => this.showToast(msg, undo);
    this.app.notifyToast = (msg, undo) => this.showToast(msg, undo);
    this.app.onImprove = () => this.agentSheet.runPreset("幫我改善，把報到和收費分開，入口旁邊留 1 公尺不要擋門");
    this.app.onChange(() => this.update());
    this.bindKeys();
    this.bindSheetGestures();
    this.applySheetState();
    this.update();
    this.buildQuickStart();
  }

  /** Measured workspace state — used by browser smoke tests and diagnostics. */
  get workspace(): WorkspaceViewportState {
    return this.viewport.current;
  }

  // --- workspace mode -----------------------------------------------------

  private onModeMaybeChanged(): void {
    if (this.builtHeaderMode === this.mode) return;
    this.builtHeaderMode = this.mode;
    this.buildTopbar();
    // Desktop docks both rails; compact layouts must never leave a sheet open
    // across a breakpoint change or the canvas comes back half-covered.
    if (this.mode === "desktop") this.setSheet("none");
    this.menu.close();
    this.update();
    this.viewport.schedule();
  }

  private get compact(): boolean {
    return this.mode !== "desktop";
  }

  private buildQuickStart(): void {
    if (quickStartSeen()) return;
    this.openQuickStart();
  }

  /** Open the Quick Start wizard (first run, or 更多 → 快速開始). */
  openQuickStart(): void {
    if (this.root.querySelector(".quickstart")) return;
    const overlay = showQuickStart(this.app, () => {
      this.viewport.schedule();
      this.update();
    });
    this.root.append(overlay);
  }

  private showToast(msg: string, undo = false): void {
    this.toast.innerHTML = "";
    this.toast.append(el("span", { text: msg }));
    if (undo) this.toast.append(button("復原", () => this.app.undo(), "chip chip--sm"));
    this.toast.style.display = "flex";
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => { this.toast.style.display = "none"; }, 4000);
  }

  // --- header -------------------------------------------------------------

  private buildTopbar(): void {
    this.topbar.innerHTML = "";
    this.snapSel = null;
    this.topbar.classList.toggle("topbar--compact", this.compact);
    if (this.compact) this.buildCompactTopbar();
    else this.buildDesktopTopbar();
  }

  /**
   * Tablet / phone header: exactly one row, exactly six slots —
   * project name / undo / redo / compact view / AI / more.
   * Workflows live in the bottom nav; everything else lives behind More.
   */
  private buildCompactTopbar(): void {
    const title = el("div", { class: "topbar__title topbar__title--compact" });
    const history = el("div", { class: "group" }, [
      button("↶", () => this.app.undo(), "chip chip--sm"),
      button("↷", () => this.app.redo(), "chip chip--sm"),
    ]);
    const viewBtn = button("視角", () => this.openViewMenu(), "chip chip--sm topbar__view");
    const ai = button("✦ AI", () => this.agentSheet.open(), "chip chip--sm chip--accent");
    const more = button("⋯", () => this.openMoreMenu(), "chip chip--sm topbar__more");
    more.setAttribute("aria-label", "更多設定");
    this.topbar.append(title, el("div", { class: "topbar__spacer" }), history, viewBtn, ai, more);
  }

  private buildDesktopTopbar(): void {
    const history = el("div", { class: "group" }, [
      button("↶", () => this.app.undo(), "chip"), button("↷", () => this.app.redo(), "chip"),
    ]);
    const views = el("div", { class: "group", "data-group": "views" },
      VIEWS.map((v) => button(v.label, () => this.app.setView(v.id), "chip chip--sm")));
    const flows = el("div", { class: "group group--flows", "data-group": "flows" },
      WORKFLOWS.map((w) => button(w.label, () => this.app.setWorkflow(w.id), "chip")));
    const snapSel = el("select", { class: "field__input field__input--inline", title: "吸附模式" }) as HTMLSelectElement;
    for (const sn of SNAPS) snapSel.append(el("option", { value: sn.id, text: `吸附：${sn.label}` }));
    snapSel.value = this.app.session.snap;
    snapSel.addEventListener("change", () => this.app.setSnap(snapSel.value as SnapMode));
    this.snapSel = snapSel;
    const more = el("div", { class: "group", "data-group": "view2" }, [
      button("名稱", () => this.app.setShowLabels(!this.app.session.showLabels), "chip chip--sm"),
      button("置中", () => this.app.recenterView(), "chip chip--sm"),
      snapSel,
      button("✦ AI", () => this.agentSheet.open(), "chip chip--sm chip--accent"),
    ]);
    const team = button("👥 夥伴模式", () => this.app.enterPartnerMode(), "chip chip--primary");
    const moreBtn = button("⋯", () => this.openMoreMenu(), "chip chip--sm topbar__more");
    moreBtn.setAttribute("aria-label", "更多設定");
    this.topbar.append(
      el("div", { class: "topbar__title", text: "平面場 ISO" }),
      history, flows, views, more, el("div", { class: "topbar__spacer" }), team, moreBtn,
    );
  }

  private openViewMenu(): void {
    const cur = this.app.store.getState().view;
    this.menu.open("視角", [{
      items: VIEWS.map((v) => ({
        label: v.label,
        active: cur === v.id,
        onSelect: () => { this.app.setView(v.id); },
      })),
    }]);
  }

  private openMoreMenu(): void {
    const sess = this.app.session;
    const groups: MenuGroup[] = [
      {
        title: "畫布",
        items: [
          { label: "顯示名稱", active: sess.showLabels, onSelect: () => { this.app.setShowLabels(!sess.showLabels); return true; } },
          { label: "置中 / 重新框選", onSelect: () => this.app.recenterView() },
          { label: "簡化顯示", active: sess.simplify, onSelect: () => { this.app.setSimplify(!sess.simplify); return true; } },
          { label: "顯示 / 隱藏格線", onSelect: () => this.app.updateTile({ visible: !this.app.store.getState().tile.visible }) },
        ],
      },
      {
        title: "吸附",
        items: SNAPS.map((sn) => ({
          label: sn.label,
          active: sess.snap === sn.id,
          onSelect: () => { this.app.setSnap(sn.id); return true; },
        })),
      },
      {
        title: "工具",
        items: [
          { label: "現場量測", onSelect: () => this.app.startMeasure(sess.measureType) },
          { label: "現場校正", onSelect: () => { this.app.setWorkflow("site"); this.app.startCalibration(); this.setSheet("workflow"); } },
          { label: "👥 夥伴模式", sub: "給夥伴看的乾淨視圖", onSelect: () => this.app.enterPartnerMode() },
        ],
      },
      {
        title: "活動",
        items: [
          { label: "🚀 快速開始", sub: "選場地、勾需求、自動排場佈", onSelect: () => this.openQuickStart() },
          { label: "重新命名活動", sub: this.app.store.getState().name, onSelect: () => this.promptRename() },
        ],
      },
      {
        title: "關於",
        items: [
          {
            label: `版本 ${BUILD_INFO.version}`,
            sub: `${BUILD_INFO.commit}${BUILD_INFO.builtAt ? ` · ${BUILD_INFO.builtAt.slice(0, 16).replace("T", " ")}` : ""}`,
            onSelect: () => true,
          },
          ...(Store.corruptBackup()
            ? [{
                label: "下載損壞前的備份",
                sub: "上次無法讀取的專案原始資料",
                onSelect: () => {
                  const raw = Store.corruptBackup();
                  if (raw) {
                    const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
                    downloadPng(url, "planform-備份.json");
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }
                },
              }]
            : []),
        ],
      },
    ];
    this.menu.open("更多", groups);
  }

  private promptRename(): void {
    const cur = this.app.store.getState().name;
    const next = window.prompt("活動名稱", cur);
    if (next !== null) this.app.store.mutate((p) => (p.name = next.trim() || cur), { history: false });
  }

  // --- bottom navigation --------------------------------------------------

  private buildNav(): void {
    this.nav.append(...WORKFLOWS.map((it) =>
      el("button", { type: "button", class: "navbtn", "data-nav": it.id }, [
        el("span", { class: "navbtn__icon", text: it.icon }), el("span", { text: it.label }),
      ])));
    this.nav.querySelectorAll<HTMLButtonElement>(".navbtn").forEach((b) =>
      b.addEventListener("click", () => {
        const w = b.dataset.nav as Workflow;
        // While the inspector is up, a workflow tap collapses back to full canvas.
        if (this.sheet === "inspector") {
          this.app.setWorkflow(w);
          this.setSheet("none");
          return;
        }
        // Re-tapping the active tab collapses the sheet back to full canvas.
        if (this.app.session.workflow === w && this.sheet === "workflow") {
          this.setSheet("none");
          return;
        }
        this.app.setWorkflow(w);
        this.setSheet("workflow");
      }));
  }

  // --- sheets -------------------------------------------------------------

  private setSheet(kind: SheetKind): void {
    if (this.sheet === kind) { this.applySheetState(); return; }
    this.sheet = kind;
    if (kind !== "none") this.sheetDetent = "half";
    this.applySheetState();
    this.syncSheetHistory();
    this.viewport.schedule();
  }

  private applySheetState(): void {
    this.root.dataset.sheet = this.compact ? this.sheet : "none";
    for (const node of [this.left, this.right]) {
      node.classList.remove("sheet--collapsed", "sheet--half", "sheet--full");
      node.classList.add(`sheet--${this.sheetDetent}`);
    }
  }

  /** Android back should dismiss the sheet before it leaves the app. */
  private syncSheetHistory(): void {
    if (typeof history === "undefined") return;
    const wantEntry = this.compact && this.sheet !== "none";
    if (wantEntry && !this.sheetHistoryPushed) {
      try { history.pushState({ planformSheet: true }, ""); this.sheetHistoryPushed = true; } catch { /* ignore */ }
    } else if (!wantEntry && this.sheetHistoryPushed) {
      this.sheetHistoryPushed = false;
      try {
        if ((history.state as { planformSheet?: boolean } | null)?.planformSheet) history.back();
      } catch { /* ignore */ }
    }
  }

  private sheetHandle(label: string): HTMLElement {
    const handle = el("div", { class: "sheet-handle", title: "向下拖曳收合面板" }, [
      el("span", { class: "sheet-handle__grip" }),
      el("span", { class: "sheet-handle__label", text: label }),
    ]);
    return handle;
  }

  private bindSheetGestures(): void {
    if (typeof window === "undefined") return;
    window.addEventListener("popstate", () => {
      if (this.sheet !== "none") {
        this.sheet = "none";
        this.sheetHistoryPushed = false;
        this.applySheetState();
        this.update();
        this.viewport.schedule();
      }
    });

    let startY = 0;
    let dragging = false;
    const onStart = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest?.(".sheet-handle")) return;
      dragging = true;
      startY = e.clientY;
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dy = e.clientY - startY;
      if (dy > 40) {
        if (this.sheetDetent === "full") this.sheetDetent = "half";
        else if (this.sheetDetent === "half") this.sheetDetent = "collapsed";
        else { this.setSheet("none"); dragging = false; this.update(); return; }
        this.applySheetState();
        this.viewport.schedule();
        dragging = false;
      } else if (dy < -40) {
        this.sheetDetent = this.sheetDetent === "collapsed" ? "half" : "full";
        this.applySheetState();
        this.viewport.schedule();
        dragging = false;
      }
    };
    const onEnd = () => { dragging = false; };
    for (const node of [this.left, this.right]) {
      node.addEventListener("pointerdown", onStart);
      node.addEventListener("pointermove", onMove);
      node.addEventListener("pointerup", onEnd);
      node.addEventListener("pointercancel", onEnd);
    }
  }

  // --- left panel (workflow-driven) --------------------------------------

  private rebuildLeft(): void {
    this.left.innerHTML = "";
    const wf = this.app.session.workflow;
    const label = WORKFLOWS.find((w) => w.id === wf)?.label ?? "";
    if (this.compact) this.left.append(this.sheetHandle(label));
    const onPick = () => { if (this.compact) this.setSheet("none"); };
    if (wf === "site") this.left.append(...this.siteSections(onPick));
    else if (wf === "layout") this.left.append(
      this.smartLayoutSection(),
      buildCustomAssetFlow(this.app),
      buildLibrary(this.app, { categories: ["furniture", "equipment", "floor", "service", "custom"], zones: true, arrays: true, onPick }),
    );
    else if (wf === "route") this.left.append(this.routeSection());
    else if (wf === "check") this.left.append(this.validationSection());
    else if (wf === "export") this.left.append(this.exportSection());
  }

  /**
   * 場地 first level is deliberately five things — 場地模板 / 教室尺寸 / 地磚 /
   * 現場校正 / 固定設施. Engineering parameters (X, Z, tile origin, tile
   * rotation) are real but rarely touched, so they sit in 進階設定 instead of
   * being the first thing a phone or tablet user meets.
   */
  private siteSections(onPick: () => void): HTMLElement[] {
    return [
      this.venuePresetSection(),
      this.roomSizeSection(),
      this.tileSection(),
      this.calibrationSection(),
      this.fixtureSection(onPick),
      this.siteAdvancedSection(),
    ];
  }

  private venuePresetSection(): HTMLElement {
    const body: HTMLElement[] = [];
    const pending = calibrationPendingLabels(this.app.store.getState());
    if (pending.length) {
      body.push(el("div", { class: "readout readout--warn", text: `⚠ 待校正：${pending.join("、")}` }),
        button("現場校正", () => { this.app.startCalibration(); }, "btn btn--primary"));
    }
    const apply = (id: string) => {
      if (window.confirm("套用場地模板會改變教室尺寸與地磚（物件會保留、可復原）。繼續？")) {
        this.app.applyVenuePresetById(id);
      }
    };
    body.push(el("div", { class: "row wrap" },
      BUILTIN_VENUE_PRESETS.map((p) => button(p.name, () => apply(p.id), "chip chip--sm"))));
    const mine = listUserVenuePresets();
    if (mine.length) {
      body.push(el("div", { class: "subhead", text: "我的場地" }));
      for (const p of mine) {
        body.push(el("div", { class: "row" }, [
          button(`🏫 ${p.name}`, () => apply(p.id), "chip chip--sm"),
          button("刪除", () => {
            if (window.confirm(`確定刪除場地模板「${p.name}」？`)) {
              deleteUserVenuePreset(p.id);
              this.update();
            }
          }, "chip chip--sm"),
        ]));
      }
    }
    const nameInput = el("input", { type: "text", class: "field__input", placeholder: "場地名稱（例如：B302）" }) as HTMLInputElement;
    body.push(el("div", { class: "row" }, [
      nameInput,
      button("儲存為我的場地", () => {
        if (this.app.saveCurrentVenuePreset(nameInput.value)) {
          nameInput.value = "";
          this.update();
        }
      }, "btn btn--ghost"),
    ]));
    return section("場地模板", body);
  }

  private roomSizeSection(): HTMLElement {
    const s = this.app.store.getState();
    const body: HTMLElement[] = [];
    for (const id of ["classroom", "corridor"] as const) {
      const a = s[id];
      body.push(el("div", { class: "subhead", text: a.name }), el("div", { class: "grid2" }, [
        num("長 (m)", a.length, 0.1, (v) => this.app.updateArea(id, { length: v }), 0.5),
        num("寬 (m)", a.width, 0.1, (v) => this.app.updateArea(id, { width: v }), 0.5),
      ]));
    }
    return section("教室尺寸", body);
  }

  private tileSection(): HTMLElement {
    const t = this.app.store.getState().tile;
    return section("地磚", [
      el("div", { class: "grid2" }, [
        num("寬 (cm)", metersToCm(t.width), 1, (v) => this.app.updateTile({ width: v / 100 }), 1),
        num("深 (cm)", metersToCm(t.depth), 1, (v) => this.app.updateTile({ depth: v / 100 }), 1),
      ]),
      el("div", { class: "row wrap" }, [30, 40, 60].map((cm) =>
        button(`${cm}×${cm}`, () => this.app.updateTile({ width: cm / 100, depth: cm / 100 }), "chip chip--sm"))),
      button("顯示 / 隱藏格線", () => this.app.updateTile({ visible: !this.app.store.getState().tile.visible }), "btn btn--ghost"),
    ]);
  }

  private fixtureSection(onPick: () => void): HTMLElement {
    return section("固定設施", [
      el("p", { class: "hint", text: "門 / 開關 / 投影幕會自動吸附牆面；門可設定開向與開門弧。" }),
      buildLibrary(this.app, { categories: ["fixture"], onPick }),
    ]);
  }

  private siteAdvancedSection(): HTMLElement {
    const s = this.app.store.getState();
    const t = s.tile;
    const body: HTMLElement[] = [
      el("p", { class: "hint", text: "座標與地磚原點只有在對齊實際建物時才需要調整。" }),
    ];
    for (const id of ["classroom", "corridor"] as const) {
      const a = s[id];
      body.push(el("div", { class: "subhead", text: `${a.name}位置` }), el("div", { class: "grid2" }, [
        num("X (m)", a.x, 0.1, (v) => this.app.updateArea(id, { x: v })),
        num("Z (m)", a.z, 0.1, (v) => this.app.updateArea(id, { z: v })),
      ]));
    }
    body.push(el("div", { class: "subhead", text: "地磚原點" }), el("div", { class: "grid2" }, [
      num("原點 X (m)", t.originX, 0.05, (v) => this.app.updateTile({ originX: v })),
      num("原點 Z (m)", t.originZ, 0.05, (v) => this.app.updateTile({ originZ: v })),
      num("旋轉 (°)", t.rotationDeg, 1, (v) => this.app.updateTile({ rotationDeg: v })),
    ]));
    body.push(buildVenueCaptureFlow(this.app));
    return section("進階設定", body, false);
  }

  private calibrationSection(): HTMLElement {
    const s = this.app.store.getState();
    const measured = this.app.getCalibrationDistance();
    const actual = el("input", { type: "number", step: "1", class: "field__input", placeholder: "實際 (cm)" }) as HTMLInputElement;
    const readout = el("div", { class: "readout" });
    const compare = () => {
      readout.innerHTML = "";
      const modelM = measured ?? s.tile.width;
      readout.append(el("div", { text: `模型量得：${(modelM * 100).toFixed(0)} cm` }));
      const cm = parseFloat(actual.value);
      if (cm) {
        const c = calibrationCompare(cm / 100, modelM);
        readout.append(el("div", { text: c.matches ? "✓ 與模型一致" : `差異：${(c.deltaMeters * 100).toFixed(1)} cm (${c.deltaPct.toFixed(1)}%)` }));
        readout.append(el("div", { class: "hint", text: "「套用到地磚 / 教室長」會改動既有場佈比例，可用復原還原。" }));
        readout.classList.toggle("readout--warn", !c.matches);
      }
    };
    actual.addEventListener("input", compare);
    compare();

    const doorInput = el("input", { type: "number", step: "1", class: "field__input", placeholder: "門寬 (cm)" }) as HTMLInputElement;
    const pending = calibrationPendingLabels(s);
    const body: HTMLElement[] = [
      ...(pending.length ? [el("div", { class: "readout readout--warn", text: `待校正：${pending.join("、")}` })] : [el("div", { class: "readout", text: "✓ 三項尺寸都已校正" })]),
      el("p", { class: "hint", text: "三個選項各自完成：量地磚、量門寬，或在圖上量一段已知距離。" }),
      this.app.session.mode === "calibrate"
        ? button("重新選點（校正中…）", () => this.startCalibrationFromSheet(), "btn btn--primary")
        : button("在畫布選兩點", () => this.startCalibrationFromSheet()),
    ];
    body.push(
      el("label", { class: "field" }, [el("span", { class: "field__label", text: "實際長度 (cm)" }), actual]),
      readout,
      el("div", { class: "row wrap" }, [
        button("記錄結果", () => this.applyCalib("record", actual)),
        button("套用到地磚", () => this.applyCalib("tile", actual), "btn btn--ghost"),
        button("套用到教室長", () => this.applyCalib("classroom-length", actual), "btn btn--ghost"),
      ]),
      el("div", { class: "subhead", text: "量門寬" }),
      el("div", { class: "row" }, [
        doorInput,
        button("更新門寬", () => this.applyCalib("door", doorInput)),
      ]),
    );
    return section("現場校正", body);
  }

  /** Picking calibration points needs the canvas, so the sheet gets out of the way. */
  private startCalibrationFromSheet(): void {
    this.app.startCalibration();
    if (this.compact) this.setSheet("none");
  }

  private applyCalib(action: "record" | "tile" | "door" | "classroom-length", input: HTMLInputElement): void {
    const cm = parseFloat(input.value);
    if (!cm) { this.showToast("請先輸入實際長度"); return; }
    this.app.applyCalibration(action, cm / 100);
  }

  /** 排地墊 options: 直向/橫向 and 相黏（gap 0）/留縫. */
  private matOrient: "v" | "h" = "v";
  private matSnug = true;
  private matMode: "individual" | "field" = "individual";

  private matOpts(): { matWidth: number; matDepth: number; gap: number; mode: "individual" | "field" } {
    if (this.matMode === "field") return { matWidth: 0.6, matDepth: 0.6, gap: 0, mode: "field" };
    const w = this.matOrient === "v" ? 0.6 : 1.8;
    const d = this.matOrient === "v" ? 1.8 : 0.6;
    return { matWidth: w, matDepth: d, gap: this.matSnug ? 0 : 0.1, mode: "individual" };
  }

  private smartLayoutSection(): HTMLElement {
    const venueId = this.app.store.getState().venuePresetId;
    this.matMode = venueId === "venue:tku-classroom" || venueId === "venue:tku-e310" ? "field" : this.matMode;
    const pIn = el("input", { type: "number", step: "1", value: this.participants, class: "field__input", inputmode: "numeric" }) as HTMLInputElement;
    pIn.addEventListener("change", () => { this.participants = Math.max(1, Math.round(parseFloat(pIn.value) || 0)); });
    const regen = () => { this.app.computeMatCandidates(this.participants, this.matOpts()); };
    const quick = el("div", { class: "row wrap" }, [20, 30, 40, 60].map((n) =>
      button(String(n), () => {
        this.participants = n;
        pIn.value = String(n);
        regen();
      }, "chip chip--sm")));
    const orientChip = (o: "v" | "h", label: string) =>
      button(label, () => { this.matOrient = o; regen(); this.update(); },
        this.matOrient === o ? "chip chip--sm chip--primary" : "chip chip--sm");
    const snugChip = button(this.matSnug ? "✓ 相黏排列" : "相黏排列", () => {
      this.matSnug = !this.matSnug;
      regen();
      this.update();
    }, this.matSnug ? "chip chip--sm chip--primary" : "chip chip--sm");
    return section("排地墊", [
      el("p", { class: "hint", text: "選人數就出 A/B/C 方案，看圖套用。先選一個區域可只排在區域內。" }),
      el("div", { class: "row wrap" }, [
        button(this.matMode === "field" ? "✓ 巧拼整片" : "巧拼整片", () => { this.matMode = "field"; regen(); this.update(); }, this.matMode === "field" ? "chip chip--sm chip--primary" : "chip chip--sm"),
        button(this.matMode === "individual" ? "✓ 個人墊" : "個人墊", () => { this.matMode = "individual"; regen(); this.update(); }, this.matMode === "individual" ? "chip chip--sm chip--primary" : "chip chip--sm"),
      ]),
      quick,
      ...(this.matMode === "individual" ? [el("div", { class: "row wrap" }, [orientChip("v", "直向"), orientChip("h", "橫向"), snugChip])] : []),
      el("div", { class: "row" }, [
        el("label", { class: "field" }, [el("span", { class: "field__label", text: "自訂人數" }), pIn]),
        button("產生方案", () => regen()),
      ]),
      this.smartBox,
    ]);
  }

  private updateSmartBox(): void {
    this.smartBox.innerHTML = "";
    const cands = this.app.session.matCandidates;
    if (!cands.length) { this.smartBox.append(el("span", { class: "hint", text: "尚未產生方案。" })); return; }
    for (const c of cands) {
      const warn = c.warnings.length ? ` ⚠ ${c.warnings.join("、")}` : " ✓ 可放置";
      this.smartBox.append(el("div", { class: `card smart ${c.fits ? "" : "smart--warn"}` }, [
        el("span", { class: "card__body" }, [
          el("span", { class: "card__title", text: c.mode === "field" ? c.label : `${c.label}（${c.count} 張）` }),
          el("span", { class: "card__sub", text: `${c.footprint.width.toFixed(1)} × ${c.footprint.depth.toFixed(1)} m${warn}` }),
        ]),
        button("套用", () => { this.app.applyMatCandidate(c.id); if (this.compact) this.setSheet("none"); }, "chip chip--sm chip--primary"),
      ]));
    }
  }

  private routeSection(): HTMLElement {
    const s = this.app.store.getState();
    const list = el("div", { class: "list" });
    for (const r of s.routes) {
      const focused = this.app.session.focusRouteId === r.id;
      list.append(el("div", { class: "list__row" }, [
        el("span", { text: `${r.name}（${r.points.length} 點）` }),
        button(this.app.session.activeRouteId === r.id ? "繪製中" : "編輯", () => { this.app.editRoute(r.id); if (this.compact) this.setSheet("none"); }, "chip chip--sm"),
        button(focused ? "取消聚焦" : "聚焦", () => { this.app.setRouteFocus(focused ? null : r.id); if (this.compact) this.setSheet("none"); }, focused ? "chip chip--sm chip--primary" : "chip chip--sm"),
        button("刪除", () => { this.app.setSelection([r.id]); this.app.deleteSelection(); }, "chip chip--sm chip--danger"),
      ]));
    }
    if (!s.routes.length) list.append(el("span", { class: "hint", text: "尚無動線。選一個類型開始畫。" }));

    const presetRow = el("div", { class: "row wrap" }, ROUTE_PRESETS.map((p) =>
      button(`${p.icon} ${p.label.replace("動線", "")}`, () => { this.app.newRoutePreset(p.type as RouteType); if (this.compact) this.setSheet("none"); }, "chip chip--sm")));

    refreshSimPanel(this.simPanelRoot, this.app);

    return section("動線", [
      el("p", { class: "hint", text: "選類型 → 在畫布點地面加入節點（起點綠、終點紅、含步驟編號）；可拖曳節點。" }),
      presetRow,
      el("div", { class: "row" }, [button("完成繪製", () => this.app.finishRoute(), "btn btn--ghost")]),
      list,
      el("div", { class: "subhead", text: "模擬活動流程" }),
      this.simPanelRoot,
    ]);
  }

  private validationSection(): HTMLElement {
    const issues = this.app.session.issues;
    const counts = issueCounts(issues);
    const list = el("div", { class: "list" });
    for (const iss of issues) {
      const row = el("button", { type: "button", class: `issue issue--${iss.severity}` }, [
        el("span", { class: "issue__icon", text: SEV_ICON[iss.severity] }),
        el("span", {}, [
          el("strong", { text: `${SEV_LABEL[iss.severity]}·${iss.shortTitle}` }),
          el("div", { class: "issue__msg", text: iss.message }),
          ...(iss.suggestedAction ? [el("div", { class: "issue__hint", text: `建議：${iss.suggestedAction}` })] : []),
        ]),
      ]) as HTMLButtonElement;
      row.addEventListener("click", () => {
        // Collapse first so the focus target is framed against the *uncovered*
        // canvas rect, not the strip left above an open sheet.
        if (this.compact) this.setSheet("none");
        this.app.focusIssue(iss);
      });
      list.append(row);
    }
    if (!issues.length) list.append(el("span", { class: "hint", text: "目前沒有問題。修改場佈後會自動重新檢查。" }));

    const vs = this.app.store.getState().validationSettings;
    const settings = section("檢查規則（門檻可調）", [
      num("最低走道寬 (cm)", Math.round(vs.minAisleWidth * 100), 5, (v) => this.app.updateValidationSettings({ minAisleWidth: v / 100 }), 0),
      num("門前淨空 (cm)", Math.round(vs.doorFrontClearance * 100), 5, (v) => this.app.updateValidationSettings({ doorFrontClearance: v / 100 }), 0),
      num("地墊距牆 (cm)", Math.round(vs.matWallClearance * 100), 5, (v) => this.app.updateValidationSettings({ matWallClearance: v / 100 }), 0),
      el("div", { class: "row wrap" }, [
        button(vs.checkScreenView ? "✓ 檢查投影幕視線" : "投影幕視線", () => this.app.updateValidationSettings({ checkScreenView: !vs.checkScreenView }), vs.checkScreenView ? "chip chip--sm chip--primary" : "chip chip--sm"),
        button(vs.checkZoneRouteIntrusion ? "✓ 檢查區域擋動線" : "區域擋動線", () => this.app.updateValidationSettings({ checkZoneRouteIntrusion: !vs.checkZoneRouteIntrusion }), vs.checkZoneRouteIntrusion ? "chip chip--sm chip--primary" : "chip chip--sm"),
      ]),
    ], false);

    return section("檢查中心", [
      el("div", { class: "row" }, [
        button("重新檢查", () => this.app.runValidation()),
        el("span", { class: "hint", text: `⛔ ${counts.error} · ⚠ ${counts.warning} · ℹ ${counts.info}` }),
      ]),
      list,
      settings,
    ]);
  }

  private exportSection(): HTMLElement {
    const state = () => this.app.store.getState();
    const importInput = el("input", { type: "file", accept: "application/json", style: "display:none" }) as HTMLInputElement;
    importInput.addEventListener("change", async () => {
      const f = importInput.files?.[0]; if (!f) return;
      try { this.app.store.loadProject(await importProjectJson(f) as never); this.showToast("已匯入專案"); } catch { this.showToast("匯入失敗：檔案格式不正確"); }
      importInput.value = "";
    });
    const layoutName = el("input", { type: "text", placeholder: "命名平面圖", class: "field__input" }) as HTMLInputElement;
    const layoutList = el("select", { class: "field__input" }) as HTMLSelectElement;
    const refreshList = () => {
      const names = this.app.store.listLayouts(); const cur = layoutList.value;
      layoutList.innerHTML = "";
      layoutList.append(el("option", { value: "", text: names.length ? "選擇平面圖…" : "尚無已存平面圖" }));
      for (const n of names) layoutList.append(el("option", { value: n, text: n }));
      if (names.includes(cur)) layoutList.value = cur;
    };
    refreshList();
    const o = this.planOpts;
    const share = (preset: PlanPreset, role: RoleFilter, kind: string, extra?: Partial<PlanOptions>) => {
      const dataUrl = renderConstructionPlan(state(), { ...o, preset, roleFilter: role, ...extra });
      void sharePng(dataUrl, pngFilename(state().name, kind)).then((how) => {
        if (how !== "cancelled") this.showToast(how === "shared" ? "已開啟分享（可直接傳 LINE）" : "圖片已下載");
      });
    };
    const planSection = section("場刊圖（傳給夥伴）", [
      el("p", { class: "hint", text: "乾淨、看得懂的圖，手機會直接開分享（LINE），電腦則下載。" }),
      el("div", { class: "row wrap" }, [
        button("場佈總覽圖", () => share("full", null, "場佈總覽")),
        button("3D 場佈圖", () => {
          const dataUrl = this.app.scene.renderToDataURL(state(), "iso");
          void sharePng(dataUrl, pngFilename(state().name, "3D場佈")).then((how) => {
            if (how !== "cancelled") this.showToast(how === "shared" ? "已開啟分享（可直接傳 LINE）" : "圖片已下載");
          });
        }),
      ]),
      el("div", { class: "row wrap" }, [
        button("動線圖", () => share("route", null, "動線圖"), "btn btn--ghost"),
        button("地墊 / 座位圖", () => share("mats", null, "地墊座位圖"), "btn btn--ghost"),
      ]),
      el("div", { class: "row wrap" }, [
        button("工作分區圖", () => share("zones", null, "工作分區圖"), "btn btn--ghost"),
        button("物資清單圖", () => share("inventory", null, "物資清單", { orientation: "portrait" }), "btn btn--ghost"),
        button("夥伴觀看圖", () => share("partner", null, "夥伴觀看圖", { simplify: true, dims: false }), "btn btn--ghost"),
      ]),
      el("div", { class: "subhead", text: "各組任務圖（只顯示該組需要的）" }),
      el("div", { class: "row wrap" }, [
        button("報到組", () => share("staff", "checkin", "報到組"), "chip chip--sm"),
        button("收費組", () => share("staff", "payment", "收費組"), "chip chip--sm"),
        button("引導組", () => share("staff", "guide", "引導組"), "chip chip--sm"),
        button("生活組", () => share("staff", "life", "生活組"), "chip chip--sm"),
      ]),
      el("div", { class: "row wrap" }, [
        button(o.dims ? "✓ 顯示尺寸" : "顯示尺寸", () => { o.dims = !o.dims; this.update(); }, o.dims ? "chip chip--sm chip--primary" : "chip chip--sm"),
        button(o.inventory ? "✓ 顯示物資數量" : "顯示物資數量", () => { o.inventory = !o.inventory; this.update(); }, o.inventory ? "chip chip--sm chip--primary" : "chip chip--sm"),
      ]),
    ]);

    const measureSection = section("現場量測", [
      selectField("量測類型", [
        { value: "free-distance", label: "任意距離" }, { value: "object-gap", label: "物件間距" },
        { value: "wall-clearance", label: "到牆距離" }, { value: "aisle-width", label: "走道寬度" },
      ], this.app.session.measureType, (v) => this.app.setMeasureType(v as MeasurementType)),
      button("開始量測（端點自動吸附）", () => { this.app.startMeasure(this.app.session.measureType); if (this.compact) this.setSheet("none"); }),
      this.measurementsList(),
    ], false);

    const advancedSection = section("進階匯出", [
      el("div", { class: "grid2" }, [
        selectField("紙張", [{ value: "a4", label: "A4" }, { value: "a3", label: "A3" }], o.page, (v) => { o.page = v as PageSize; }),
        selectField("方向", [{ value: "landscape", label: "橫式" }, { value: "portrait", label: "直式" }], o.orientation, (v) => { o.orientation = v as PageOrientation; }),
      ]),
      button(o.simplify ? "✓ 簡化顯示（略過開關、電腦）" : "簡化顯示（略過開關、電腦）", () => { o.simplify = !o.simplify; this.update(); }, o.simplify ? "chip chip--sm chip--primary" : "chip chip--sm"),
      el("div", { class: "subhead", text: "模擬摘要" }),
      el("p", { class: "hint", text: this.app.session.simResult
        ? this.app.session.simResult.summaryLines.join(" ")
        : "先到「動線」跑一次 ▶ 模擬，再回來匯出摘要。" }),
      button("匯出模擬摘要圖", () => {
        const r = this.app.session.simResult ?? this.app.runEventSimulation();
        share("route", null, "模擬摘要", { simplify: true, titleSuffix: "模擬摘要", extraNotes: r.summaryLines });
      }, "btn btn--ghost"),
      button("3D 示意圖", () => downloadPng(this.app.scene.renderToDataURL(state(), "iso"), pngFilename(state().name, "3D示意")), "btn btn--ghost"),
      el("div", { class: "subhead", text: "專案資料（備份 / 搬機）" }),
      el("div", { class: "row" }, [
        button("匯出 JSON", () => exportProjectJson(state())),
        button("匯入 JSON", () => importInput.click(), "btn btn--ghost"),
      ]),
      importInput,
    ], false);

    return section("分享 / 匯出", [
      planSection,
      el("div", { class: "subhead", text: "活動資訊" }),
      textField("活動名稱", state().name, (v) => this.app.store.mutate((p) => (p.name = v), { history: false })),
      textField("簡短說明（夥伴模式顯示）", state().description, (v) => this.app.updateDescription(v)),
      el("div", { class: "subhead", text: "我的平面圖（本機儲存）" }),
      el("div", { class: "row" }, [layoutName, button("儲存", () => { this.app.store.saveNamedLayout(layoutName.value.trim() || state().name); refreshList(); this.showToast("已儲存平面圖"); })]),
      el("div", { class: "row" }, [layoutList,
        button("載入", () => { if (layoutList.value) this.app.store.loadNamedLayout(layoutList.value); }, "btn btn--ghost"),
        button("刪除", () => {
          const name = layoutList.value;
          if (!name) return;
          if (!window.confirm(`確定刪除平面圖「${name}」？此動作無法復原。`)) return;
          this.app.store.deleteNamedLayout(name);
          refreshList();
          this.showToast(`已刪除「${name}」`);
        }, "btn btn--ghost")]),
      measureSection,
      advancedSection,
    ]);
  }

  private measurementsList(): HTMLElement {
    const list = el("div", { class: "list" });
    const ms = this.app.store.getState().measurements;
    for (const m of ms) {
      const len = Math.hypot(m.end.x - m.start.x, m.end.z - m.start.z);
      list.append(el("div", { class: "list__row" }, [
        el("span", { text: `${(len * 100).toFixed(0)} cm` }),
        button(m.visible ? "顯示" : "隱藏", () => this.app.toggleMeasurementVisible(m.id), "chip chip--sm"),
        button("刪除", () => this.app.deleteMeasurement(m.id), "chip chip--sm chip--danger"),
      ]));
    }
    if (!ms.length) list.append(el("span", { class: "hint", text: "尚無保留的尺寸線。" }));
    return list;
  }

  // --- update ------------------------------------------------------------

  private update(): void {
    const sess = this.app.session;
    const s = this.app.store.getState();

    if (this.compact) {
      const title = this.topbar.querySelector(".topbar__title--compact");
      if (title) title.textContent = s.name || "平面場 ISO";
    } else {
      setPressed(this.topbar, "views", (b) => VIEWS[b].id === s.view);
      setPressed(this.topbar, "flows", (b) => WORKFLOWS[b].id === sess.workflow);
      setPressed(this.topbar, "view2", (b) => (b === 0 ? sess.showLabels : false));
      if (this.snapSel && document.activeElement !== this.snapSel) this.snapSel.value = sess.snap;
    }
    const viewLabel = VIEWS.find((v) => v.id === s.view)?.label ?? "視角";
    const viewBtn = this.topbar.querySelector(".topbar__view");
    if (viewBtn) viewBtn.textContent = viewLabel;

    this.nav.querySelectorAll<HTMLButtonElement>(".navbtn").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.nav === sess.workflow && this.sheet === "workflow")));

    // Picking an asset drops straight into placement — get the sheet out of the way.
    if (this.compact && sess.mode === "place" && this.lastMode !== "place") this.setSheet("none");
    this.lastMode = sess.mode;

    if (this.shouldRebuildLeft(sess.workflow)) {
      this.lastWorkflow = sess.workflow;
      this.rebuildLeft();
    }

    // Smart layout + simulation live boxes.
    this.updateSmartBox();
    if (sess.workflow === "route") refreshSimPanel(this.simPanelRoot, this.app);

    // Partner Mode shell (replaces the editor chrome entirely).
    this.updatePartnerMode();

    // Inspector: docked rail on desktop, opt-in sheet everywhere else.
    const hasSel = sess.selection.size > 0;
    if (!hasSel && this.sheet === "inspector") this.setSheet("none");
    this.right.innerHTML = "";
    if (this.compact && this.sheet === "inspector") this.right.append(this.sheetHandle("屬性"));
    this.right.append(buildInspector(this.app, this.advanced, (v) => { this.advanced = v; this.update(); }));
    const inPartner = !!sess.partner;
    const dockedInspector = !this.compact && hasSel && !inPartner && dockingPolicy(this.mode).autoOpenInspector;
    this.root.classList.toggle("show-inspector", dockedInspector);

    // Compact selection never auto-opens the inspector; it gets a context bar.
    // While placing or measuring, the mode's own bar owns that slot instead.
    const showCtx = this.compact && hasSel && this.sheet !== "inspector"
      && !inPartner && sess.mode === "select";
    this.ctxbar.style.display = showCtx ? "flex" : "none";
    if (showCtx) renderContextBar(this.ctxbar, this.app, { onOpenProperties: () => { this.setSheet("inspector"); this.update(); } });

    this.applySheetState();

    // Placement + measure bars.
    // The floating bottom bar serves placement AND route drawing, so 完成
    // is always on screen even when the compact sheet is collapsed.
    if (sess.mode === "place") {
      if (this.placebarKind !== "place") {
        this.placebar.innerHTML = "";
        this.placebar.append(buildPlacementToolbar(this.app));
        this.placebarKind = "place";
      }
      this.placebar.style.display = "flex";
    } else if (sess.mode === "route" && sess.activeRouteId) {
      if (this.placebarKind !== "route") {
        this.placebar.innerHTML = "";
        this.placebar.append(el("div", { class: "placebar" }, [
          el("span", { class: "placebar__hint", text: "點地面新增動線節點" }),
          button("完成繪製", () => this.app.finishRoute(), "chip chip--primary"),
        ]));
        this.placebarKind = "route";
      }
      this.placebar.style.display = "flex";
    } else {
      this.placebar.style.display = "none";
      this.placebarKind = null;
    }
    this.updateMeasureBar();
    this.viewport.schedule();
  }

  /**
   * Rebuild the workflow panel when it can actually have changed — but never
   * while the user is typing into it, which on a tablet means losing the
   * keyboard and the caret mid-number.
   */
  private shouldRebuildLeft(wf: Workflow): boolean {
    if (this.lastWorkflow !== wf) return true;
    if (wf === "layout") return false;
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.left.contains(active)) {
      const tag = active.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return false;
    }
    return true;
  }

  /**
   * Partner Mode replaces the editor chrome rather than layering on top of it:
   * the topbar, rails, bottom nav and context bar all go away, so the plan is
   * the only thing on screen.
   */
  private updatePartnerMode(): void {
    const on = !!this.app.session.partner;
    this.root.classList.toggle("partner", on);
    if (on) {
      this.setSheet("none");
      this.menu.close();
      this.partner.update();
    } else if (this.partner.currentSheet() !== "none") {
      this.partner.closeSheet();
    }
    if (on !== this.partnerWasOn) {
      this.partnerWasOn = on;
      // Swapping the whole chrome changes the visible canvas rect, so re-frame
      // once the new strips have actually been laid out and measured.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        this.viewport.measure();
        this.app.recenterView();
      }));
    }
  }

  private partnerWasOn = false;

  private updateMeasureBar(): void {
    const mode = this.app.session.mode;
    const on = mode === "measure" || mode === "calibrate";
    this.measurebar.style.display = on ? "flex" : "none";
    if (!on) return;
    this.measurebar.innerHTML = "";
    if (mode === "calibrate") {
      const d = this.app.getCalibrationDistance();
      this.measurebar.append(
        el("span", { class: "measurebar__text", text: d !== null ? `模型距離 ${d.toFixed(2)} m（回校正面板輸入實際值）` : "點兩個已知距離的端點" }),
        button("取消校正", () => this.app.cancelCalibration(), "chip chip--sm"),
      );
      return;
    }
    const r = this.app.getMeasureResult();
    const text = r
      ? `${r.meters.toFixed(2)} m · ${r.cm.toFixed(0)} cm · X ${r.dxCm.toFixed(0)} / Z ${r.dzCm.toFixed(0)} cm · 約 ${r.tilesDiagonal.toFixed(1)} 格`
      : "點兩個位置量距離（端點會自動吸附）";
    this.measurebar.append(
      el("span", { class: "measurebar__text", text }),
      button("保留", () => this.app.keepMeasurement(), "chip chip--sm chip--primary"),
      button("清除", () => this.app.clearMeasure(), "chip chip--sm"),
      button("完成", () => this.app.stopMeasure(), "chip chip--sm"),
    );
  }

  private renderBox(rect: { minX: number; minY: number; maxX: number; maxY: number } | null): void {
    if (!rect) { this.box.style.display = "none"; return; }
    this.box.style.display = "block";
    this.box.style.left = `${rect.minX}px`; this.box.style.top = `${rect.minY}px`;
    this.box.style.width = `${rect.maxX - rect.minX}px`; this.box.style.height = `${rect.maxY - rect.minY}px`;
  }

  private bindKeys(): void {
    window.addEventListener("keydown", (e) => {
      const tgt = e.target as HTMLElement;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "SELECT" || tgt.tagName === "TEXTAREA")) return;
      // Partner Mode is read-only: only Escape (close a sheet, then leave).
      if (this.app.session.partner) {
        if (e.key !== "Escape") return;
        if (this.partner.currentSheet() !== "none") this.partner.closeSheet();
        else this.app.exitPartnerMode();
        return;
      }
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "z" && !e.shiftKey) { e.preventDefault(); this.app.undo(); }
      else if ((e.ctrlKey || e.metaKey) && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); this.app.redo(); }
      else if (e.key === "Escape") {
        if (this.menu.isOpen()) { this.menu.close(); return; }
        if (this.compact && this.sheet !== "none") { this.setSheet("none"); this.update(); return; }
        this.app.cancelPlacement();
        if (this.app.session.mode === "measure") this.app.stopMeasure();
        if (this.app.session.mode === "calibrate") this.app.cancelCalibration();
      }
      else if (e.key === "Delete" || e.key === "Backspace") this.app.deleteSelection();
      else if (k === "r") { if (this.app.session.mode === "place") this.app.rotateGhost(); else this.app.rotateSelection(15); }
      else if (k === "d") this.app.duplicateSelection();
      else if (e.key.startsWith("Arrow") && this.app.session.selection.size > 0) {
        e.preventDefault();
        const tile = this.app.store.getState().tile;
        const step = e.shiftKey ? tile.width : 0.05; // Shift = one tile, else 5cm
        const stepZ = e.shiftKey ? tile.depth : 0.05;
        if (e.key === "ArrowUp") this.app.nudgeSelection(0, -stepZ);
        else if (e.key === "ArrowDown") this.app.nudgeSelection(0, stepZ);
        else if (e.key === "ArrowLeft") this.app.nudgeSelection(-step, 0);
        else if (e.key === "ArrowRight") this.app.nudgeSelection(step, 0);
      }
    });
  }
}

type Mode = App["session"]["mode"];

function setPressed(root: HTMLElement, group: string, pred: (i: number) => boolean): void {
  const c = root.querySelector(`[data-group="${group}"]`);
  if (!c) return;
  Array.from(c.querySelectorAll("button")).forEach((b, i) => b.setAttribute("aria-pressed", String(pred(i))));
}

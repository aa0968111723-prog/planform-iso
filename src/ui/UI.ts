import { App, type Workflow } from "../app/App";
import { metersToCm, type SnapMode } from "../core/units";
import type { ViewName } from "../core/model";
import { calibrationCompare } from "../core/measure";
import { issueCounts, type Severity } from "../core/validation";
import { renderConstructionPlan } from "../export/constructionPlan";
import { downloadPng, exportProjectJson, importProjectJson } from "../export/exporters";
import { buildInspector } from "./inspector";
import { buildLibrary, buildPlacementToolbar } from "./library";
import { button, el, num, section, textField } from "./dom";

const VIEWS: { id: ViewName; label: string }[] = [
  { id: "iso", label: "等角" }, { id: "top", label: "俯視" }, { id: "front", label: "正視" },
  { id: "left", label: "左視" }, { id: "right", label: "右視" },
];
const SNAPS: { id: SnapMode; label: string }[] = [
  { id: "off", label: "自由" }, { id: "intersection", label: "交點" }, { id: "edge", label: "邊線" },
  { id: "center", label: "中心" }, { id: "half", label: "半格" },
];
const WORKFLOWS: { id: Workflow; label: string }[] = [
  { id: "site", label: "場地" }, { id: "layout", label: "排佈" }, { id: "route", label: "動線" },
  { id: "check", label: "檢查" }, { id: "export", label: "匯出" },
];
const SEV_LABEL: Record<Severity, string> = { error: "錯誤", warning: "警告", info: "建議" };
const SEV_ICON: Record<Severity, string> = { error: "⛔", warning: "⚠", info: "ℹ" };

export class UI {
  private topbar = el("header", { class: "topbar" });
  private left = el("aside", { class: "left" });
  private right = el("aside", { class: "right" });
  private nav = el("nav", { class: "bottomnav" });
  private placebar = el("div", { class: "placebar-wrap", style: "display:none" });
  private measurebar = el("div", { class: "measurebar", style: "display:none" });
  private box = el("div", { class: "boxsel", style: "display:none" });
  private advanced = false;
  private lastWorkflow: Workflow | null = null;
  private snapSel: HTMLSelectElement | null = null;

  constructor(private app: App, private root: HTMLElement) {
    root.append(this.topbar, this.left, this.right, this.nav, this.placebar, this.measurebar, this.box);
    this.buildTopbar();
    this.buildNav();
    this.placebar.append(buildPlacementToolbar(app));
    this.app.onBox = (rect) => this.renderBox(rect);
    this.app.onChange(() => this.update());
    this.bindKeys();
    this.update();
  }

  private buildTopbar(): void {
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
    ]);
    this.topbar.append(el("div", { class: "topbar__title", text: "平面場 ISO" }), history, flows, views, more);
  }

  private buildNav(): void {
    const items: { w: Workflow; label: string; icon: string }[] = [
      { w: "site", label: "場地", icon: "▦" }, { w: "layout", label: "素材", icon: "▤" },
      { w: "route", label: "動線", icon: "↝" }, { w: "check", label: "檢查", icon: "✓" },
      { w: "export", label: "更多", icon: "⋯" },
    ];
    this.nav.append(...items.map((it) =>
      el("button", { type: "button", class: "navbtn", "data-nav": it.w }, [
        el("span", { class: "navbtn__icon", text: it.icon }), el("span", { text: it.label }),
      ])));
    this.nav.querySelectorAll<HTMLButtonElement>(".navbtn").forEach((b) =>
      b.addEventListener("click", () => { this.app.setWorkflow(b.dataset.nav as Workflow); this.root.classList.add("show-left"); }));
  }

  // --- left panel (workflow-driven) --------------------------------------

  private rebuildLeft(): void {
    this.left.innerHTML = "";
    const wf = this.app.session.workflow;
    if (wf === "site") this.left.append(
      this.areaSection(), this.tileSection(), this.calibrationSection(),
      section("固定設施", [buildLibraryFixturesHint(), buildLibrary(this.app, { categories: ["fixture"] })]),
    );
    else if (wf === "layout") this.left.append(buildLibrary(this.app, { categories: ["furniture", "equipment", "floor"], zones: true, arrays: true }));
    else if (wf === "route") this.left.append(this.routeSection());
    else if (wf === "check") this.left.append(this.validationSection());
    else if (wf === "export") this.left.append(this.exportSection());
  }

  private areaSection(): HTMLElement {
    const s = this.app.store.getState();
    const body: HTMLElement[] = [];
    for (const id of ["classroom", "corridor"] as const) {
      const a = s[id];
      body.push(el("div", { class: "subhead", text: a.name }), el("div", { class: "grid2" }, [
        num("長 (m)", a.length, 0.1, (v) => this.app.updateArea(id, { length: v }), 0.5),
        num("寬 (m)", a.width, 0.1, (v) => this.app.updateArea(id, { width: v }), 0.5),
        num("X (m)", a.x, 0.1, (v) => this.app.updateArea(id, { x: v })),
        num("Z (m)", a.z, 0.1, (v) => this.app.updateArea(id, { z: v })),
      ]));
    }
    return section("教室 / 走廊", body);
  }

  private tileSection(): HTMLElement {
    const t = this.app.store.getState().tile;
    return section("地磚", [
      el("div", { class: "grid2" }, [
        num("寬 (cm)", metersToCm(t.width), 1, (v) => this.app.updateTile({ width: v / 100 }), 1),
        num("深 (cm)", metersToCm(t.depth), 1, (v) => this.app.updateTile({ depth: v / 100 }), 1),
        num("原點 X (m)", t.originX, 0.05, (v) => this.app.updateTile({ originX: v })),
        num("原點 Z (m)", t.originZ, 0.05, (v) => this.app.updateTile({ originZ: v })),
        num("旋轉 (°)", t.rotationDeg, 1, (v) => this.app.updateTile({ rotationDeg: v })),
      ]),
      el("div", { class: "row wrap" }, [30, 40, 60].map((cm) =>
        button(`${cm}×${cm}`, () => this.app.updateTile({ width: cm / 100, depth: cm / 100 }), "chip chip--sm"))),
      button("顯示 / 隱藏格線", () => this.app.updateTile({ visible: !this.app.store.getState().tile.visible }), "btn btn--ghost"),
    ]);
  }

  private calibrationSection(): HTMLElement {
    const s = this.app.store.getState();
    const typeSel = el("select", { class: "field__input" }) as HTMLSelectElement;
    typeSel.append(el("option", { value: "tile", text: "一塊地磚" }), el("option", { value: "wall", text: "教室長邊牆面" }));
    const actual = el("input", { type: "number", step: "1", class: "field__input", placeholder: "實際 (cm)" }) as HTMLInputElement;
    const readout = el("div", { class: "readout" });
    const apply = button("套用", () => {
      const cm = parseFloat(actual.value);
      if (!cm) return;
      if (typeSel.value === "tile") this.app.applyCalibrationToTile(cm / 100);
      else this.app.updateArea("classroom", { length: cm / 100 });
    });
    const compare = () => {
      const cm = parseFloat(actual.value);
      readout.innerHTML = "";
      const modelM = typeSel.value === "tile" ? s.tile.width : s.classroom.length;
      readout.append(el("div", { text: `目前模型值：${(modelM * 100).toFixed(0)} cm` }));
      if (cm) {
        const c = calibrationCompare(cm / 100, modelM);
        readout.append(el("div", { text: c.matches ? "✓ 與模型一致" : `差異：${(c.deltaMeters * 100).toFixed(1)} cm (${c.deltaPct.toFixed(1)}%)` }));
        readout.classList.toggle("readout--warn", !c.matches);
      }
    };
    actual.addEventListener("input", compare);
    typeSel.addEventListener("change", compare);
    compare();
    return section("現場校正", [
      el("p", { class: "hint", text: "選你在現場量得到的尺寸，輸入實際值核對比例，再選擇是否套用。" }),
      el("label", { class: "field" }, [el("span", { class: "field__label", text: "校正對象" }), typeSel]),
      el("label", { class: "field" }, [el("span", { class: "field__label", text: "實際長度 (cm)" }), actual]),
      readout,
      apply,
    ]);
  }

  private routeSection(): HTMLElement {
    const s = this.app.store.getState();
    const list = el("div", { class: "list" });
    for (const r of s.routes) {
      list.append(el("div", { class: "list__row" }, [
        el("span", { text: `${r.name}（${r.points.length} 點）` }),
        button(this.app.session.activeRouteId === r.id ? "繪製中" : "編輯", () => this.app.editRoute(r.id), "chip chip--sm"),
        button("刪除", () => { this.app.setSelection([r.id]); this.app.deleteSelection(); }, "chip chip--sm chip--danger"),
      ]));
    }
    if (!s.routes.length) list.append(el("span", { class: "hint", text: "尚無動線。" }));
    return section("動線", [
      el("p", { class: "hint", text: "新增後在畫布點擊地面加入節點；可拖曳節點調整。" }),
      el("div", { class: "row" }, [button("新增動線", () => this.app.newRoute()), button("完成繪製", () => this.app.finishRoute(), "btn btn--ghost")]),
      list,
    ]);
  }

  private validationSection(): HTMLElement {
    const issues = this.app.session.issues;
    const counts = issueCounts(issues);
    const list = el("div", { class: "list" });
    for (const iss of issues) {
      const row = el("button", { type: "button", class: `issue issue--${iss.severity}` }, [
        el("span", { class: "issue__icon", text: SEV_ICON[iss.severity] }),
        el("span", { text: `${SEV_LABEL[iss.severity]}：${iss.message}` }),
      ]) as HTMLButtonElement;
      row.addEventListener("click", () => this.app.focusIssue(iss));
      list.append(row);
    }
    if (!issues.length) list.append(el("span", { class: "hint", text: "尚未發現問題，點「重新檢查」更新。" }));
    return section("檢查中心", [
      el("div", { class: "row" }, [
        button("重新檢查", () => this.app.runValidation()),
        el("span", { class: "hint", text: `⛔ ${counts.error} · ⚠ ${counts.warning} · ℹ ${counts.info}` }),
      ]),
      list,
    ]);
  }

  private exportSection(): HTMLElement {
    const state = () => this.app.store.getState();
    const importInput = el("input", { type: "file", accept: "application/json", style: "display:none" }) as HTMLInputElement;
    importInput.addEventListener("change", async () => {
      const f = importInput.files?.[0]; if (!f) return;
      try { this.app.store.loadProject(await importProjectJson(f) as never); } catch { alert("匯入失敗：JSON 格式錯誤"); }
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
    return section("匯出 / 儲存", [
      el("div", { class: "subhead", text: "施工用輸出" }),
      button("匯出工作人員場佈圖 (PNG)", () => downloadPng(renderConstructionPlan(state()), "planform-construction.png")),
      button("匯出 3D 示意圖 (PNG)", () => downloadPng(this.app.scene.renderToDataURL(state(), "iso"), "planform-3d.png"), "btn btn--ghost"),
      el("div", { class: "row" }, [
        button("匯出 JSON", () => exportProjectJson(state())),
        button("匯入 JSON", () => importInput.click(), "btn btn--ghost"),
      ]),
      importInput,
      el("div", { class: "subhead", text: "本機平面圖" }),
      textField("名稱", state().name, (v) => this.app.store.mutate((p) => (p.name = v), { history: false })),
      el("div", { class: "row" }, [layoutName, button("儲存", () => { this.app.store.saveNamedLayout(layoutName.value.trim() || state().name); refreshList(); })]),
      el("div", { class: "row" }, [layoutList,
        button("載入", () => { if (layoutList.value) this.app.store.loadNamedLayout(layoutList.value); }, "btn btn--ghost"),
        button("刪除", () => { if (layoutList.value) { this.app.store.deleteNamedLayout(layoutList.value); refreshList(); } }, "btn btn--ghost")]),
      el("div", { class: "subhead", text: "量測" }),
      button("開始量測 (兩點距離)", () => this.app.startMeasure()),
    ]);
  }

  // --- update ------------------------------------------------------------

  private update(): void {
    const sess = this.app.session;
    const s = this.app.store.getState();
    setPressed(this.topbar, "views", (b) => VIEWS[b].id === s.view);
    setPressed(this.topbar, "flows", (b) => WORKFLOWS[b].id === sess.workflow);
    setPressed(this.topbar, "view2", (b) => (b === 0 ? sess.showLabels : false));
    if (this.snapSel && document.activeElement !== this.snapSel) this.snapSel.value = sess.snap;
    this.nav.querySelectorAll<HTMLButtonElement>(".navbtn").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.nav === sess.workflow)));

    if (this.lastWorkflow !== sess.workflow || sess.workflow === "check" || sess.workflow === "route") {
      this.lastWorkflow = sess.workflow;
      this.rebuildLeft();
    }

    // Inspector.
    this.right.innerHTML = "";
    this.right.append(buildInspector(this.app, this.advanced, (v) => { this.advanced = v; this.update(); }));
    this.root.classList.toggle("show-inspector", sess.selection.size > 0);

    // Placement + measure bars.
    this.placebar.style.display = sess.mode === "place" ? "flex" : "none";
    this.updateMeasureBar();
  }

  private updateMeasureBar(): void {
    const on = this.app.session.mode === "measure";
    this.measurebar.style.display = on ? "flex" : "none";
    if (!on) return;
    this.measurebar.innerHTML = "";
    const r = this.app.getMeasureResult();
    const text = r
      ? `${r.meters.toFixed(2)} m（${r.cm.toFixed(0)} cm）· 約 ${r.tilesDiagonal.toFixed(1)} 格`
      : "點兩個位置量距離";
    this.measurebar.append(
      el("span", { class: "measurebar__text", text }),
      button("清除", () => this.app.clearMeasure(), "chip chip--sm"),
      button("完成", () => this.app.stopMeasure(), "chip chip--sm chip--primary"),
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
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "z" && !e.shiftKey) { e.preventDefault(); this.app.undo(); }
      else if ((e.ctrlKey || e.metaKey) && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); this.app.redo(); }
      else if (e.key === "Escape") { this.app.cancelPlacement(); if (this.app.session.mode === "measure") this.app.stopMeasure(); }
      else if (e.key === "Delete" || e.key === "Backspace") this.app.deleteSelection();
      else if (k === "r") { if (this.app.session.mode === "place") this.app.rotateGhost(); else this.app.rotateSelection(15); }
      else if (k === "d") this.app.duplicateSelection();
    });
  }
}

function buildLibraryFixturesHint(): HTMLElement {
  return el("p", { class: "hint", text: "門 / 開關 / 投影幕會自動吸附牆面；門可設定開向與開門弧。" });
}

function setPressed(root: HTMLElement, group: string, pred: (i: number) => boolean): void {
  const c = root.querySelector(`[data-group="${group}"]`);
  if (!c) return;
  Array.from(c.querySelectorAll("button")).forEach((b, i) => b.setAttribute("aria-pressed", String(pred(i))));
}

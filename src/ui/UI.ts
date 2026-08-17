import { App } from "../app/App";
import {
  OBJECT_DEFAULTS,
  ZONE_DEFAULTS,
  type ObjectKind,
  type ViewName,
  type ZoneType,
} from "../core/model";
import { matArrayFootprint, zoneMatCapacity } from "../core/mat";
import { formatTileRef, metersToCm, worldToTile } from "../core/units";
import type { SnapMode } from "../core/units";
import { migrate } from "../state/store";
import {
  downloadPng,
  exportProjectJson,
  importProjectJson,
} from "../export/exporters";
import { button, el, num, section, textField } from "./dom";

const VIEWS: { id: ViewName; label: string }[] = [
  { id: "iso", label: "等角" },
  { id: "top", label: "俯視" },
  { id: "front", label: "正視" },
  { id: "left", label: "左視" },
  { id: "right", label: "右視" },
];

const SNAPS: { id: SnapMode; label: string }[] = [
  { id: "off", label: "自由" },
  { id: "intersection", label: "交點" },
  { id: "edge", label: "邊線" },
  { id: "center", label: "中心" },
  { id: "half", label: "半格" },
];

const TILE_PRESETS = [30, 40, 60];

export class UI {
  private topbar: HTMLElement;
  private panel: HTMLElement;
  private selBar: HTMLElement;
  private box: HTMLElement;
  private dynamic = el("div");
  private matReadout = el("div", { class: "readout" });
  private inputs: Record<string, HTMLInputElement> = {};

  constructor(private app: App, private root: HTMLElement) {
    this.topbar = el("header", { class: "topbar" });
    this.panel = el("aside", { class: "panel" });
    this.selBar = el("div", { class: "selbar", style: "display:none" });
    this.box = el("div", { class: "boxsel", style: "display:none" });
    root.append(this.topbar, this.panel, this.selBar, this.box);

    this.buildTopbar();
    this.buildPanel();

    this.app.onBox = (rect) => this.renderBox(rect);
    this.app.onChange(() => this.update());
    this.bindKeys();
    this.update();
  }

  // --- top bar -----------------------------------------------------------

  private buildTopbar(): void {
    const title = el("div", { class: "topbar__title", text: "平面場 ISO" });

    const views = el("div", { class: "group", "data-group": "views" },
      VIEWS.map((v) => button(v.label, () => this.app.setView(v.id), "chip")));

    const history = el("div", { class: "group" }, [
      button("復原", () => this.app.undo(), "chip"),
      button("重做", () => this.app.redo(), "chip"),
    ]);

    const modes = el("div", { class: "group", "data-group": "modes" }, [
      button("選取", () => this.app.setMode("select"), "chip"),
      button("動線", () => this.app.setMode("route"), "chip"),
    ]);

    const snap = el("div", { class: "group", "data-group": "snap" },
      SNAPS.map((s) => button(s.label, () => this.app.setSnap(s.id), "chip chip--sm")));

    const layers = el("div", { class: "group", "data-group": "layers" },
      (["areas", "tiles", "zones", "objects", "routes"] as const).map((l) =>
        button(layerLabel(l), () => this.app.toggleLayer(l), "chip chip--sm")));

    const panelToggle = button("面板", () => this.root.classList.toggle("panel-open"), "chip");

    this.topbar.append(title, views, modes, snap, layers, history, panelToggle);
  }

  // --- panel -------------------------------------------------------------

  private buildPanel(): void {
    this.panel.append(
      this.projectSection(),
      this.ioSection(),
      this.areaSection(),
      this.calibrationSection(),
      this.tileSection(),
      this.zoneSection(),
      this.objectSection(),
      this.matSection(),
      this.routeSection(),
      section("選取資訊", [this.dynamic]),
    );
  }

  private projectSection(): HTMLElement {
    const name = textField("名稱", this.app.store.getState().name, (v) =>
      this.app.store.mutate((p) => (p.name = v), { history: false }));
    this.inputs.projName = name.querySelector("input")!;

    const layoutName = el("input", { type: "text", placeholder: "命名平面圖", class: "field__input" });
    const layoutList = el("select", { class: "field__input" }) as HTMLSelectElement;
    layoutList.id = "layoutList";
    this.inputs.layoutList = layoutList as unknown as HTMLInputElement;

    const save = button("儲存平面圖", () => {
      const n = layoutName.value.trim() || this.app.store.getState().name;
      this.app.store.saveNamedLayout(n);
      this.update();
    });
    const load = button("載入", () => {
      if (layoutList.value) this.app.store.loadNamedLayout(layoutList.value);
    }, "btn btn--ghost");
    const del = button("刪除", () => {
      if (layoutList.value) {
        this.app.store.deleteNamedLayout(layoutList.value);
        this.update();
      }
    }, "btn btn--ghost");

    return section("平面圖", [
      name,
      el("div", { class: "row" }, [layoutName, save]),
      el("div", { class: "row" }, [layoutList, load, del]),
    ]);
  }

  private ioSection(): HTMLElement {
    const importInput = el("input", { type: "file", accept: "application/json", style: "display:none" }) as HTMLInputElement;
    importInput.addEventListener("change", async () => {
      const file = importInput.files?.[0];
      if (!file) return;
      try {
        const data = await importProjectJson(file);
        this.app.store.loadProject(migrate(data));
      } catch {
        alert("匯入失敗：JSON 格式錯誤");
      }
      importInput.value = "";
    });

    return section("匯入 / 匯出", [
      el("div", { class: "row" }, [
        button("匯出 JSON", () => exportProjectJson(this.app.store.getState())),
        button("匯入 JSON", () => importInput.click(), "btn btn--ghost"),
      ]),
      el("div", { class: "row" }, [
        button("匯出俯視 PNG", () =>
          downloadPng(this.app.scene.exportPng(this.app.store.getState(), "top", "layout"), "planform-top.png")),
        button("匯出動線 PNG", () =>
          downloadPng(this.app.scene.exportPng(this.app.store.getState(), "top", "flow"), "planform-flow.png")),
      ]),
      importInput,
    ]);
  }

  private areaSection(): HTMLElement {
    const body: HTMLElement[] = [];
    for (const id of ["classroom", "corridor"] as const) {
      const a = this.app.store.getState()[id];
      const len = num("長 (m)", a.length, 0.1, (v) => this.app.updateArea(id, { length: v }), 0.5);
      const wid = num("寬 (m)", a.width, 0.1, (v) => this.app.updateArea(id, { width: v }), 0.5);
      const px = num("X (m)", a.x, 0.1, (v) => this.app.updateArea(id, { x: v }));
      const pz = num("Z (m)", a.z, 0.1, (v) => this.app.updateArea(id, { z: v }));
      this.inputs[`${id}_len`] = len.querySelector("input")!;
      this.inputs[`${id}_wid`] = wid.querySelector("input")!;
      this.inputs[`${id}_x`] = px.querySelector("input")!;
      this.inputs[`${id}_z`] = pz.querySelector("input")!;
      body.push(
        el("div", { class: "subhead", text: a.name }),
        el("div", { class: "grid2" }, [len, wid, px, pz]),
      );
    }
    return section("大區域（教室 / 走廊）", body);
  }

  private calibrationSection(): HTMLElement {
    const c = this.app.store.getState().calibration;
    const ref = num("參考長度 (m)", c.referenceLength ?? 0, 0.05, (v) =>
      this.app.updateCalibration({ referenceLength: v || null }), 0);
    this.inputs.calRef = ref.querySelector("input")!;
    const note = textField("備註", c.note, (v) => this.app.updateCalibration({ note: v }));
    this.inputs.calNote = note.querySelector("input")!;
    return section("現場校正", [
      el("p", { class: "hint", text: "輸入已知的一塊地磚或一段牆面實際長度，用來核對比例。" }),
      ref,
      note,
    ]);
  }

  private tileSection(): HTMLElement {
    const t = this.app.store.getState().tile;
    const w = num("地磚寬 (cm)", metersToCm(t.width), 1, (v) => this.app.updateTile({ width: v / 100 }), 1);
    const d = num("地磚深 (cm)", metersToCm(t.depth), 1, (v) => this.app.updateTile({ depth: v / 100 }), 1);
    const ox = num("原點 X (m)", t.originX, 0.05, (v) => this.app.updateTile({ originX: v }));
    const oz = num("原點 Z (m)", t.originZ, 0.05, (v) => this.app.updateTile({ originZ: v }));
    const rot = num("旋轉 (°)", t.rotationDeg, 1, (v) => this.app.updateTile({ rotationDeg: v }));
    this.inputs.tileW = w.querySelector("input")!;
    this.inputs.tileD = d.querySelector("input")!;
    this.inputs.tileOX = ox.querySelector("input")!;
    this.inputs.tileOZ = oz.querySelector("input")!;
    this.inputs.tileRot = rot.querySelector("input")!;

    const presets = el("div", { class: "row" },
      TILE_PRESETS.map((cm) => button(`${cm}×${cm}`, () =>
        this.app.updateTile({ width: cm / 100, depth: cm / 100 }), "chip chip--sm")));

    const vis = button("顯示 / 隱藏格線", () =>
      this.app.updateTile({ visible: !this.app.store.getState().tile.visible }), "btn btn--ghost");

    return section("地磚", [
      el("div", { class: "grid2" }, [w, d, ox, oz, rot]),
      presets,
      vis,
    ]);
  }

  private zoneSection(): HTMLElement {
    return section("加入小區域", [
      el("div", { class: "row wrap" },
        (Object.keys(ZONE_DEFAULTS) as ZoneType[]).map((t) =>
          button(ZONE_DEFAULTS[t].label, () => this.app.addZone(t), "chip"))),
    ]);
  }

  private objectSection(): HTMLElement {
    return section("加入物件", [
      el("div", { class: "row wrap" },
        (Object.keys(OBJECT_DEFAULTS) as ObjectKind[]).map((k) =>
          button(OBJECT_DEFAULTS[k].label, () => this.app.addObject(k), "chip"))),
    ]);
  }

  private matSection(): HTMLElement {
    const start = button("開始地墊模擬", () => this.app.startMatPreview());
    const mw = num("墊寬 (m)", 0.6, 0.05, (v) => this.app.updateMatPreview({ spec: { matWidth: v } }), 0.1);
    const md = num("墊深 (m)", 1.8, 0.05, (v) => this.app.updateMatPreview({ spec: { matDepth: v } }), 0.1);
    const rows = num("列數", 3, 1, (v) => this.app.updateMatPreview({ spec: { rows: v } }), 1);
    const cols = num("行數", 4, 1, (v) => this.app.updateMatPreview({ spec: { cols: v } }), 1);
    const gx = num("水平間距 (m)", 0.1, 0.05, (v) => this.app.updateMatPreview({ spec: { gapX: v } }), 0);
    const gz = num("垂直間距 (m)", 0.1, 0.05, (v) => this.app.updateMatPreview({ spec: { gapZ: v } }), 0);
    const rot = num("旋轉 (°)", 0, 5, (v) => this.app.updateMatPreview({ rotationDeg: v }));
    this.inputs.matW = mw.querySelector("input")!;
    this.inputs.matD = md.querySelector("input")!;
    this.inputs.matRows = rows.querySelector("input")!;
    this.inputs.matCols = cols.querySelector("input")!;
    this.inputs.matGX = gx.querySelector("input")!;
    this.inputs.matGZ = gz.querySelector("input")!;
    this.inputs.matRot = rot.querySelector("input")!;

    const confirm = button("確認擺放", () => this.app.confirmMatPreview());
    const cancel = button("取消", () => this.app.cancelMatPreview(), "btn btn--ghost");

    return section("地墊模擬", [
      el("p", { class: "hint", text: "選取一個小區域後開始模擬，可看到容量與超界資訊。" }),
      start,
      el("div", { class: "grid2" }, [mw, md, rows, cols, gx, gz, rot]),
      this.matReadout,
      el("div", { class: "row" }, [confirm, cancel]),
    ]);
  }

  private routeSection(): HTMLElement {
    const newR = button("新增動線", () => this.app.newRoute());
    const finish = button("完成繪製", () => this.app.finishRoute(), "btn btn--ghost");
    this.routesList = el("div", { class: "list" });
    return section("動線", [
      el("p", { class: "hint", text: "「動線」模式下點擊地面加入節點，可拖曳節點調整。" }),
      el("div", { class: "row" }, [newR, finish]),
      this.routesList,
    ]);
  }

  private routesList = el("div");

  // --- dynamic update ----------------------------------------------------

  private update(): void {
    const s = this.app.store.getState();
    const sess = this.app.session;

    // Pressed states.
    setPressed(this.topbar, "views", (b) => VIEWS[b].id === s.view);
    setPressed(this.topbar, "modes", (b) => (b === 0 ? sess.mode === "select" : sess.mode === "route"));
    setPressed(this.topbar, "snap", (b) => SNAPS[b].id === sess.snap);
    const layerKeys = ["areas", "tiles", "zones", "objects", "routes"] as const;
    setPressed(this.topbar, "layers", (b) => s.layers[layerKeys[b]]);

    // Refresh static input values (undo/redo/import may have changed them).
    this.setVal("projName", s.name);
    this.setVal("classroom_len", s.classroom.length);
    this.setVal("classroom_wid", s.classroom.width);
    this.setVal("classroom_x", s.classroom.x);
    this.setVal("classroom_z", s.classroom.z);
    this.setVal("corridor_len", s.corridor.length);
    this.setVal("corridor_wid", s.corridor.width);
    this.setVal("corridor_x", s.corridor.x);
    this.setVal("corridor_z", s.corridor.z);
    this.setVal("calRef", s.calibration.referenceLength ?? 0);
    this.setVal("calNote", s.calibration.note);
    this.setVal("tileW", metersToCm(s.tile.width));
    this.setVal("tileD", metersToCm(s.tile.depth));
    this.setVal("tileOX", s.tile.originX);
    this.setVal("tileOZ", s.tile.originZ);
    this.setVal("tileRot", s.tile.rotationDeg);

    this.updateLayoutList();
    this.updateMatReadout();
    this.updateRoutesList();
    this.updateSelection();
  }

  private setVal(key: string, value: string | number): void {
    const input = this.inputs[key];
    if (input && document.activeElement !== input) input.value = String(value);
  }

  private updateLayoutList(): void {
    const list = this.inputs.layoutList as unknown as HTMLSelectElement;
    if (!list) return;
    const names = this.app.store.listLayouts();
    const current = list.value;
    list.innerHTML = "";
    list.append(el("option", { value: "", text: names.length ? "選擇平面圖…" : "尚無已存平面圖" }));
    for (const n of names) list.append(el("option", { value: n, text: n }));
    if (names.includes(current)) list.value = current;
  }

  private updateMatReadout(): void {
    const pre = this.app.session.matPreview;
    this.matReadout.innerHTML = "";
    if (!pre) {
      this.matReadout.append(el("span", { class: "hint", text: "尚未開始模擬。" }));
      return;
    }
    // Reflect current spec into inputs.
    this.setVal("matW", pre.spec.matWidth);
    this.setVal("matD", pre.spec.matDepth);
    this.setVal("matRows", pre.spec.rows);
    this.setVal("matCols", pre.spec.cols);
    this.setVal("matGX", pre.spec.gapX);
    this.setVal("matGZ", pre.spec.gapZ);
    this.setVal("matRot", pre.rotationDeg);

    const fp = matArrayFootprint(pre.spec);
    const rows = [
      `地墊數：${fp.count}`,
      `占用：${fp.totalWidth.toFixed(2)} × ${fp.totalDepth.toFixed(2)} m`,
    ];
    const zone = pre.zoneId ? this.app.store.getState().zones.find((z) => z.id === pre.zoneId) : null;
    if (zone) {
      const cap = zoneMatCapacity(zone.width, zone.depth, pre.spec);
      rows.push(`區域容量：${cap.maxCols} × ${cap.maxRows} = ${cap.capacity} 墊`);
      if (cap.fits) rows.push(`剩餘：${cap.clearanceX.toFixed(2)} × ${cap.clearanceZ.toFixed(2)} m`);
      else rows.push(`⚠ 超出區域：${cap.overflowX.toFixed(2)} × ${cap.overflowZ.toFixed(2)} m`);
      this.matReadout.classList.toggle("readout--warn", !cap.fits);
    } else {
      this.matReadout.classList.remove("readout--warn");
    }
    for (const r of rows) this.matReadout.append(el("div", { text: r }));
  }

  private updateRoutesList(): void {
    this.routesList.innerHTML = "";
    const s = this.app.store.getState();
    for (const route of s.routes) {
      const nameInput = el("input", { type: "text", value: route.name, class: "field__input field__input--sm" }) as HTMLInputElement;
      nameInput.addEventListener("change", () => this.app.updateRoute(route.id, { name: nameInput.value }));
      const color = el("input", { type: "color", value: route.color, class: "color" }) as HTMLInputElement;
      color.addEventListener("input", () => this.app.updateRoute(route.id, { color: color.value }));
      const vis = button(route.visible ? "顯示" : "隱藏", () =>
        this.app.updateRoute(route.id, { visible: !route.visible }), "chip chip--sm");
      const edit = button(this.app.session.activeRouteId === route.id ? "繪製中" : "編輯", () => {
        this.app.setMode("route");
        this.app.session.activeRouteId = route.id;
        this.app.setSelection([route.id]);
      }, "chip chip--sm");
      const del = button("刪除", () => {
        this.app.setSelection([route.id]);
        this.app.deleteSelection();
      }, "chip chip--sm");
      this.routesList.append(
        el("div", { class: "list__row" }, [nameInput, color, vis, edit, del,
          el("span", { class: "hint", text: `${route.points.length} 點` })]),
      );
    }
    if (s.routes.length === 0) this.routesList.append(el("span", { class: "hint", text: "尚無動線。" }));
  }

  private updateSelection(): void {
    this.dynamic.innerHTML = "";
    const obj = this.app.getSelectedObject();
    const zone = this.app.getSelectedZone();
    const count = this.app.session.selection.size;

    if (count === 0) {
      this.selBar.style.display = "none";
      this.dynamic.append(el("span", { class: "hint", text: "未選取任何物件。" }));
      return;
    }
    this.selBar.style.display = "flex";
    this.selBar.innerHTML = "";
    this.selBar.append(
      button("旋轉 15°", () => this.app.rotateSelection(15), "chip"),
      button("複製", () => this.app.duplicateSelection(), "chip"),
      button("鎖定", () => this.app.toggleLockSelection(), "chip"),
      button("隱藏", () => this.app.toggleHideSelection(), "chip"),
      button("刪除", () => this.app.deleteSelection(), "chip chip--danger"),
    );

    if (count > 1) {
      this.dynamic.append(el("div", { text: `已選取 ${count} 個項目` }));
      return;
    }

    if (obj) {
      const s = this.app.store.getState();
      const ref = worldToTile(obj.x, obj.z, s.tile);
      const wall = obj.z - s.classroom.z;
      const w = num("寬 (m)", obj.width, 0.05, (v) => this.app.updateSelectedObject({ width: v }), 0.05);
      const d = num("深 (m)", obj.depth, 0.05, (v) => this.app.updateSelectedObject({ depth: v }), 0.05);
      const rot = num("旋轉 (°)", obj.rotationDeg, 5, (v) => this.app.updateSelectedObject({ rotationDeg: v }));
      this.dynamic.append(
        el("div", { class: "subhead", text: OBJECT_DEFAULTS[obj.kind].label }),
        el("div", { class: "readout" }, [
          el("div", { text: formatTileRef(ref) }),
          el("div", { text: `座標：${obj.x.toFixed(2)}, ${obj.z.toFixed(2)} m` }),
          el("div", { text: `距上牆：${wall.toFixed(2)} m` }),
        ]),
        el("div", { class: "grid2" }, [w, d, rot]),
      );
    } else if (zone) {
      const name = textField("名稱", zone.name, (v) => this.app.updateSelectedZone({ name: v }));
      const w = num("寬 (m)", zone.width, 0.1, (v) => this.app.updateSelectedZone({ width: v }), 0.2);
      const d = num("深 (m)", zone.depth, 0.1, (v) => this.app.updateSelectedZone({ depth: v }), 0.2);
      this.dynamic.append(
        el("div", { class: "subhead", text: `區域：${ZONE_DEFAULTS[zone.type].label}` }),
        name,
        el("div", { class: "grid2" }, [w, d]),
      );
    } else {
      this.dynamic.append(el("div", { text: "已選取動線（可於動線區編輯）" }));
    }
  }

  private renderBox(rect: { minX: number; minY: number; maxX: number; maxY: number } | null): void {
    if (!rect) {
      this.box.style.display = "none";
      return;
    }
    this.box.style.display = "block";
    this.box.style.left = `${rect.minX}px`;
    this.box.style.top = `${rect.minY}px`;
    this.box.style.width = `${rect.maxX - rect.minX}px`;
    this.box.style.height = `${rect.maxY - rect.minY}px`;
  }

  private bindKeys(): void {
    window.addEventListener("keydown", (e) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        this.app.undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        this.app.redo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        this.app.deleteSelection();
      } else if (e.key.toLowerCase() === "r") {
        this.app.rotateSelection(15);
      } else if (e.key.toLowerCase() === "d") {
        this.app.duplicateSelection();
      }
    });
  }
}

function layerLabel(l: string): string {
  return { areas: "區域", tiles: "格線", zones: "小區", objects: "物件", routes: "動線" }[l] ?? l;
}

function setPressed(root: HTMLElement, group: string, pred: (index: number) => boolean): void {
  const container = root.querySelector(`[data-group="${group}"]`);
  if (!container) return;
  const buttons = Array.from(container.querySelectorAll("button"));
  buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(pred(i))));
}

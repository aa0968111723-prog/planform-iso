import type { App } from "../app/App";
import { assetDef } from "../core/assets";
import { metersToCm } from "../core/units";
import { buildSummaryLines } from "../core/summary";
import { memberLabel } from "../core/arrays";
import type { NumberOrder, NumberStart } from "../core/model";
import { EDITOR_LAYER_DEFS, objectsByEditorLayer, zoneEditorLayer } from "../core/editorLayers";
import { facingLabel, formatSize, objectWorkbenchSummary, SIZE_PRESETS_M } from "../core/objectWorkbench";
import { button, el, num, section, selectField, textField } from "./dom";

// Nudge step persists across inspector rebuilds.
let nudgeStep = 0.01;
let sizeUnit: "m" | "cm" = "cm";

/** Right-side inspector: answers "what have I selected?" — contextual only. */
export function buildInspector(app: App, advanced: boolean, setAdvanced: (v: boolean) => void): HTMLElement {
  const root = el("div", { class: "inspector" });
  const obj = app.getSelectedObject();
  const zone = app.getSelectedZone();
  const group = app.getSelectedGroup();
  const route = app.getSelectedRoute();
  const count = app.session.selection.size;
  void setAdvanced;

  if (count === 0) {
    root.append(el("div", { class: "subhead", text: "場地摘要" }));
    const box = el("div", { class: "readout" });
    for (const line of buildSummaryLines(app.store.getState())) box.append(el("div", { text: line }));
    root.append(box, el("p", { class: "hint", text: "從左側素材庫選一個素材開始擺放，或點選場景中的物件查看資訊。" }), buildObjectLayerPanel(app));
    return root;
  }

  root.append(el("div", { class: "toolrow" }, [
    button("旋轉", () => app.rotateSelection(15), "chip chip--sm"),
    button("複製", () => app.duplicateSelection(), "chip chip--sm"),
    button("鎖定", () => app.toggleLockSelection(), "chip chip--sm"),
    button("隱藏", () => app.toggleHideSelection(), "chip chip--sm"),
    button("刪除", () => app.deleteSelection(), "chip chip--sm chip--danger"),
  ]));

  if (count > 1) {
    root.append(el("div", { text: `已選取 ${count} 個項目` }));
    root.append(el("div", { class: "subhead", text: "對齊 / 分佈 / 排列" }));
    root.append(el("div", { class: "row wrap" }, [
      button("左", () => app.alignSelection("left"), "chip chip--sm"),
      button("右", () => app.alignSelection("right"), "chip chip--sm"),
      button("上", () => app.alignSelection("top"), "chip chip--sm"),
      button("下", () => app.alignSelection("bottom"), "chip chip--sm"),
      button("水平置中", () => app.alignSelection("centerX"), "chip chip--sm"),
      button("垂直置中", () => app.alignSelection("centerZ"), "chip chip--sm"),
      button("水平等距", () => app.distributeSelection("x"), "chip chip--sm"),
      button("垂直等距", () => app.distributeSelection("z"), "chip chip--sm"),
      button("格線排列", () => app.gridArrangeSelection(app.store.getState().tile.width), "chip chip--sm"),
      button("設成群組", () => app.groupSelectedObjects(), "chip chip--sm"),
      button("解除群組", () => app.ungroupSelectedObjects(), "chip chip--sm"),
      button("一起縮小", () => app.scaleSelection(0.9), "chip chip--sm"),
      button("一起放大", () => app.scaleSelection(1.1), "chip chip--sm"),
    ]));
    root.append(nudgePanel(app));
    return root;
  }

  if (obj) buildObjectInspector(root, app, obj);
  else if (group) buildGroupInspector(root, app, group, advanced);
  else if (zone) buildZoneInspector(root, app, zone);
  else if (route) buildRouteInspector(root, app, route);
  return root;
}

/**
 * §26 — 「骰到 ④ 認識自己 / 目前：對談中 / 已互動 01:12」 for the selected
 * station, plus §85's four anchor sentences.
 *
 * On the SELECTED object only. §26's own 不要 is 「不要所有人頭上一直顯示」 —
 * a plan with ten interactive props would otherwise be unreadable exactly
 * when you are trying to watch the crowd.
 */
function propStationPanel(root: HTMLElement, app: App, objectId: string): void {
  const guide = app.propAnchorGuide(objectId);
  if (!guide) return;

  const now = app.propStationNow(objectId);
  if (now) {
    root.append(el("div", { class: "subhead", text: "彩排中" }));
    const box = el("div", { class: "readout" });
    if (now.result) {
      const row = el("div", { class: "row" }, [
        el("span", { class: "readout__label", text: "骰到" }),
        ...(now.resultColor
          ? [el("span", { class: "swatch", style: `background:${now.resultColor}` })]
          : []),
        el("strong", { text: now.result }),
      ]);
      box.append(row);
      if (now.doing) box.append(el("div", { text: `目前：${now.doing}` }));
      if (now.since) box.append(el("div", { text: `已互動：${now.since}` }));
    } else {
      box.append(el("div", { text: "還沒有人玩過（按 ▶ 開始彩排看現場）" }));
    }
    box.append(el("div", { text: `現在：${now.serving} 人在玩、${now.queued} 人在排` }));
    root.append(box);
  }

  root.append(el("div", { class: "subhead", text: "大家站哪裡" }));
  const lines = el("div", { class: "readout" });
  for (const line of guide.lines) {
    lines.append(el("div", {}, [
      el("span", { class: "readout__label", text: line.icon }),
      el("span", { text: line.text }),
    ]));
  }
  root.append(lines);
}

function nudgePanel(app: App): HTMLElement {
  const tile = app.store.getState().tile;
  const steps: { label: string; v: number }[] = [
    { label: "1cm", v: 0.01 }, { label: "10cm", v: 0.1 },
    { label: "50cm", v: 0.5 }, { label: "一格", v: tile.width },
  ];
  const stepRow = el("div", { class: "row wrap" }, steps.map((s) =>
    button(s.label, () => { nudgeStep = s.v; markStep(); }, "chip chip--sm nudgestep")));
  const markStep = () => stepRow.querySelectorAll<HTMLButtonElement>(".nudgestep").forEach((b, i) =>
    b.setAttribute("aria-pressed", String(Math.abs(steps[i].v - nudgeStep) < 1e-6)));
  markStep();
  const pad = el("div", { class: "nudgepad" }, [
    button("↑", () => app.nudgeSelection(0, -nudgeStep), "chip"),
    el("div", { class: "row" }, [
      button("←", () => app.nudgeSelection(-nudgeStep, 0), "chip"),
      button("→", () => app.nudgeSelection(nudgeStep, 0), "chip"),
    ]),
    button("↓", () => app.nudgeSelection(0, nudgeStep), "chip"),
  ]);
  return el("div", {}, [el("div", { class: "subhead", text: "精準移動" }), stepRow, pad]);
}

function rotationPanel(app: App, cur: number): HTMLElement {
  const custom = el("input", { type: "number", step: "1", value: Math.round(cur), class: "field__input field__input--inline" }) as HTMLInputElement;
  custom.addEventListener("change", () => app.setSelectionRotation(parseFloat(custom.value) || 0));
  return el("div", {}, [
    el("div", { class: "subhead", text: "旋轉" }),
    el("div", { class: "row wrap" }, [
      button("15°", () => app.rotateSelection(15), "chip chip--sm"),
      button("45°", () => app.rotateSelection(45), "chip chip--sm"),
      button("90°", () => app.rotateSelection(90), "chip chip--sm"),
      custom,
    ]),
  ]);
}

function buildObjectInspector(root: HTMLElement, app: App, obj: ReturnType<App["getSelectedObject"]> & object): void {
  const def = assetDef(obj.kind);
  const prop = app.propForObject(obj.id);
  const project = app.store.getState();
  const summary = objectWorkbenchSummary(obj, project);
  const showCoords = project.showCoords !== false;
  const toUnit = (m: number) => sizeUnit === "m" ? m : metersToCm(m);
  const fromUnit = (v: number) => sizeUnit === "m" ? v : v / 100;
  const unitLabel = sizeUnit === "m" ? "m" : "cm";
  const step = sizeUnit === "m" ? 0.01 : 1;

  root.append(el("div", { class: "wb-head" }, [
    el("div", { class: "wb-head__title", text: `${summary.icon} ${summary.name}` }),
    el("div", { class: "wb-head__meta", text: `${summary.type} · ${formatSize(obj, sizeUnit)} · ${facingLabel(obj.rotationDeg)} · ${summary.zoneName ?? "未分區"}` }),
  ]));
  root.append(el("div", { class: "row wrap" }, [
    button(obj.locked ? "已鎖定" : "鎖定", () => app.toggleLockSelection(), obj.locked ? "chip chip--sm chip--primary" : "chip chip--sm"),
    button(obj.hidden ? "已隱藏" : "隱藏", () => app.toggleHideSelection(), "chip chip--sm"),
    button(obj.snapEnabled === false ? "吸附關" : "吸附開", () => app.updateSelectedObject({ snapEnabled: obj.snapEnabled === false }), obj.snapEnabled === false ? "chip chip--sm" : "chip chip--sm chip--primary"),
    button(summary.blocksCirculation ? "擋動線" : "不擋動線", () => app.updateSelectedObject({ blocksCirculation: !summary.blocksCirculation }), summary.blocksCirculation ? "chip chip--sm chip--primary" : "chip chip--sm"),
    button("鏡頭", () => { app.scene.focusOn(obj.x, obj.z); }, "chip chip--sm"),
  ]));

  if (obj.kind === "table" || obj.kind === "regTable") {
    root.append(button(app.tabletopHost?.id === obj.id ? "離開桌面佈置" : "進入桌面佈置", () => {
      if (app.tabletopHost?.id === obj.id) app.exitTabletopLayout();
      else app.enterTabletopLayout();
    }, "btn btn--primary"));
  }
  if (prop) {
    root.append(el("div", { class: "row wrap" }, [
      button("編輯這個道具", () => app.openPropStudioFor(prop.id), "chip chip--sm"),
      el("span", { class: "hint", text: "尺寸與外觀在道具工作室裡改" }),
    ]));
  }

  root.append(section("基本", [
    textField("名稱", obj.name ?? summary.name, (v) => app.renameSelectedObject(v)),
    textField("畫面標注", obj.label ?? obj.name ?? def.displayName, (v) => app.updateSelectedLabel({ label: v })),
    el("div", { class: "readout", text: `類型：${summary.type}` }),
    textField("圖示", obj.icon ?? summary.icon, (v) => app.updateSelectedObject({ icon: v })),
    textField("顏色（#RRGGBB）", obj.color ?? summary.color, (v) => app.updateSelectedObject({ color: v })),
    textField("備註", obj.note ?? "", (v) => app.updateSelectedObject({ note: v })),
    textField("自訂名稱", obj.customProperties?.alias ?? "", (v) => app.updateSelectedObject({
      customProperties: { ...(obj.customProperties ?? {}), alias: v },
    })),
  ]));

  const posFields: HTMLElement[] = [
    button(showCoords ? "隱藏座標" : "顯示座標", () => app.setShowCoords(!showCoords), "chip chip--sm"),
    selectField("所在空間", [
      { value: "classroom", label: "教室" }, { value: "corridor", label: "走廊" },
    ], summary.space === "corridor" ? "corridor" : "classroom", () => { /* informational */ }),
    el("div", { class: "readout", text: `區域：${summary.zoneName ?? "（無）"}` }),
    el("div", { class: "readout", text: `距牆 左 ${Math.round(summary.wallWest * 100)} · 上 ${Math.round(summary.wallNorth * 100)} · 右 ${Math.round(summary.wallEast * 100)} · 下 ${Math.round(summary.wallSouth * 100)} cm` }),
    ...(summary.nearestGap !== null ? [el("div", { class: "readout", text: `距最近同類 ${Math.round(summary.nearestGap * 100)} cm` })] : []),
  ];
  if (showCoords) {
    posFields.unshift(el("div", { class: "grid2" }, [
      num(`X (${unitLabel})`, toUnit(obj.x), step, (v) => app.updateSelectedObject({ x: fromUnit(v) })),
      num(`Z (${unitLabel})`, toUnit(obj.z), step, (v) => app.updateSelectedObject({ z: fromUnit(v) })),
      num(`離地 (${unitLabel})`, toUnit(obj.elevation), step, (v) => app.updateSelectedObject({ elevation: fromUnit(v) }), 0),
    ]));
  }
  root.append(section("位置", posFields));

  const sizeBody: HTMLElement[] = [
    el("div", { class: "row wrap" }, [
      button(sizeUnit === "cm" ? "✓ 公分" : "公分", () => { sizeUnit = "cm"; app.refreshUi(); }, sizeUnit === "cm" ? "chip chip--sm chip--primary" : "chip chip--sm"),
      button(sizeUnit === "m" ? "✓ 公尺" : "公尺", () => { sizeUnit = "m"; app.refreshUi(); }, sizeUnit === "m" ? "chip chip--sm chip--primary" : "chip chip--sm"),
      button(obj.keepAspect ? "✓ 維持比例" : "維持比例", () => app.setSelectedKeepAspect(!obj.keepAspect), obj.keepAspect ? "chip chip--sm chip--primary" : "chip chip--sm"),
      button("恢復原尺寸", () => app.restoreOriginalSize(), "chip chip--sm"),
    ]),
    el("div", { class: "grid2" }, [
      num(`寬 (${unitLabel})`, toUnit(obj.width), step, (v) => app.setSelectedSize({ width: fromUnit(v) }), sizeUnit === "m" ? 0.05 : 5),
      num(`深 (${unitLabel})`, toUnit(obj.depth), step, (v) => app.setSelectedSize({ depth: fromUnit(v) }), sizeUnit === "m" ? 0.05 : 5),
      num(`高 (${unitLabel})`, toUnit(obj.height), step, (v) => app.setSelectedSize({ height: fromUnit(v) }), sizeUnit === "m" ? 0.01 : 1),
    ]),
  ];
  if (!prop && def.presets.length > 1) {
    sizeBody.push(el("div", { class: "row wrap" },
      def.presets.map((pr) => button(pr.label, () => app.applyPresetToSelection(pr.id), obj.presetId === pr.id ? "chip chip--sm chip--primary" : "chip chip--sm"))));
  }
  sizeBody.push(el("div", { class: "row wrap" }, SIZE_PRESETS_M.filter((p) => p.id !== "keep").map((p) =>
    button(p.label, () => app.setSelectedSize({ width: p.width, depth: p.depth }), "chip chip--sm"))));
  root.append(section("尺寸", sizeBody));

  const facingBody: HTMLElement[] = [
    num("角度 (°)", obj.rotationDeg, 1, (v) => app.setSelectionRotation(v)),
    el("div", { class: "row wrap" }, [
      button("1°", () => app.rotateSelection(1), "chip chip--sm"),
      button("5°", () => app.rotateSelection(5), "chip chip--sm"),
      button("15°", () => app.rotateSelection(15), "chip chip--sm"),
      button("45°", () => app.rotateSelection(45), "chip chip--sm"),
      button("90°", () => app.rotateSelection(90), "chip chip--sm"),
      button("翻轉", () => app.flipSelection(), "chip chip--sm"),
    ]),
    el("div", { class: "row wrap" }, [
      button("朝入口", () => app.faceSelection("entrance"), "chip chip--sm"),
      button("朝投影幕", () => app.faceSelection("screen"), "chip chip--sm"),
      button("朝講師", () => app.faceSelection("lecturer"), "chip chip--sm"),
      button("朝走道", () => app.faceSelection("aisle"), "chip chip--sm"),
    ]),
  ];
  if (obj.kind === "door") {
    facingBody.push(
      selectField("開門邊", [{ value: "left", label: "左鉸鏈" }, { value: "right", label: "右鉸鏈" }], obj.hinge ?? "left", (v) => app.setDoorParams({ hinge: v as "left" | "right" })),
      selectField("方向", [{ value: "in", label: "向內開" }, { value: "out", label: "向外開" }], obj.openInward === false ? "out" : "in", (v) => app.setDoorParams({ openInward: v === "in" })),
      num("開啟角度 (°)", obj.openDeg ?? 90, 5, (v) => app.setDoorParams({ openDeg: v }), 0),
    );
  }
  if (obj.surface !== "wall") facingBody.push(rotationPanel(app, obj.rotationDeg));
  facingBody.push(nudgePanel(app));
  root.append(section("朝向", facingBody));

  const surfaceLabel = obj.surface === "wall" ? "wall" : obj.surface === "tabletop" ? "tabletop" : "floor";
  root.append(section("放置", [
    selectField("放置面", [
      { value: "floor", label: "地面" }, { value: "wall", label: "牆面" }, { value: "tabletop", label: "桌面" },
    ], surfaceLabel, (v) => app.updateSelectedObject({ surface: v as "floor" | "wall" | "tabletop" })),
    el("div", { class: "row wrap" }, [
      button("吸附牆", () => app.setSnap("wall"), "chip chip--sm"),
      button("吸附磚", () => app.setSnap("center"), "chip chip--sm"),
      button("吸附格", () => app.setSnap("intersection"), "chip chip--sm"),
      button("吸附物件", () => app.setSnap("object"), "chip chip--sm"),
      button("自由", () => app.setSnap("off"), "chip chip--sm"),
    ]),
    button(obj.collisionEnabled === false ? "碰撞關閉" : "碰撞開啟", () => app.updateSelectedObject({ collisionEnabled: obj.collisionEnabled === false }), "chip chip--sm"),
    button(summary.blocksCirculation ? "✓ 擋住動線" : "擋住動線", () => app.updateSelectedObject({ blocksCirculation: !summary.blocksCirculation }), summary.blocksCirculation ? "chip chip--sm chip--primary" : "chip chip--sm"),
    button(obj.allowOverflow ? "✓ 允許超出邊界" : "允許超出邊界", () => app.updateSelectedObject({ allowOverflow: !obj.allowOverflow }), obj.allowOverflow ? "chip chip--sm chip--primary" : "chip chip--sm"),
    ...(obj.surface === "tabletop" ? [button(
      obj.allowTabletopOverflow ? "限制在桌面內" : "允許超出桌緣",
      () => app.updateSelectedObject({ allowTabletopOverflow: !obj.allowTabletopOverflow }),
      "chip chip--sm",
    )] : []),
    ...(obj.parentId ? [button("跟隨桌面", () => app.updateSelectedObject({ parentId: obj.parentId }), "chip chip--sm"), button("解除關聯", () => app.detachComputer(), "chip chip--sm")] : []),
  ]));

  const labelPos = obj.labelPosition ?? { offsetX: 0, offsetY: 0, offsetZ: 0 };
  root.append(section("顯示", [
    button(obj.hidden ? "顯示物件" : "隱藏物件", () => app.toggleHideSelection(), "chip chip--sm"),
    button(obj.showLabel === false ? "顯示此標注" : "隱藏此標注", () => app.updateSelectedLabel({ showLabel: obj.showLabel === false }), "chip chip--sm"),
    num("標注字級", obj.labelStyle?.fontSize ?? 26, 1, (v) => app.updateSelectedLabel({ labelStyle: { ...obj.labelStyle, fontSize: v } }), 10),
    textField("標注文字色", obj.labelStyle?.color ?? "#f8fafc", (v) => app.updateSelectedLabel({ labelStyle: { ...obj.labelStyle, color: v } })),
    textField("標注底色", obj.labelStyle?.background ?? "#172033", (v) => app.updateSelectedLabel({ labelStyle: { ...obj.labelStyle, background: v } })),
    num("標注左右 cm", Math.round(labelPos.offsetX * 100), 1, (v) => app.updateSelectedLabel({ labelPosition: { ...labelPos, offsetX: v / 100 } }), -500),
    num("不透明度", Math.round((obj.opacity ?? 1) * 100), 5, (v) => app.updateSelectedObject({ opacity: v / 100 }), 10),
    button(obj.visibleInEdit === false ? "編輯時隱藏" : "✓ 編輯時可見", () => app.updateSelectedObject({ visibleInEdit: obj.visibleInEdit === false }), "chip chip--sm"),
    button(obj.visibleInPartner === false ? "場刊隱藏" : "✓ 場刊可見", () => app.updateSelectedObject({ visibleInPartner: obj.visibleInPartner === false }), "chip chip--sm"),
    button(obj.visibleInExport === false ? "匯出隱藏" : "✓ 匯出可見", () => app.updateSelectedObject({ visibleInExport: obj.visibleInExport === false }), "chip chip--sm"),
  ], false));

  root.append(section("管理", [
    el("div", { class: "row wrap" }, [
      button(obj.locked ? "解鎖" : "鎖定", () => app.toggleLockSelection(), "chip chip--sm"),
      button("設成群組", () => app.groupSelectedObjects(), "chip chip--sm"),
      button("解除群組", () => app.ungroupSelectedObjects(), "chip chip--sm"),
      button("移到最前", () => app.bringSelectionToFront(), "chip chip--sm"),
      button("移到最後", () => app.sendSelectionToBack(), "chip chip--sm"),
      button("複製", () => app.duplicateSelection(), "chip chip--sm"),
      button("刪除", () => app.deleteSelection(), "chip chip--sm chip--danger"),
      button("復原", () => app.undo(), "chip chip--sm"),
    ]),
    el("div", { class: "hint", text: app.store.canUndo?.() ? "有未儲存的步驟，可用復原" : "與上次儲存一致" }),
    ...(obj.groupId ? [el("div", { class: "row wrap" }, [
      button("選取整個群組", () => app.selectObjectGroup(obj.id), "chip chip--sm"),
      button("從群組移除", () => app.ungroupSelectedObjects(), "chip chip--sm"),
    ])] : []),
    ...(obj.assetId ? [button(
      app.isAssetFavorite(obj.assetId) ? "★ 已收藏這個素材" : "☆ 收藏這個素材",
      () => app.toggleAssetFavorite(obj.assetId!),
      "chip chip--sm",
    )] : []),
  ], false));

  propStationPanel(root, app, obj.id);
}

/** A compact persistent object/layer list. It deliberately uses the same App
 * mutators as canvas interactions, so visibility and lock state are saved,
 * undoable, and never become a UI-only shadow copy. */
function buildObjectLayerPanel(app: App): HTMLElement {
  const state = app.store.getState();
  const grouped = objectsByEditorLayer(state);
  const panel = el("div", { class: "list" });
  panel.append(el("div", { class: "subhead", text: "物件與圖層" }));
  const layers = state.workbenchLayers;
  for (const def of EDITOR_LAYER_DEFS) {
    const vis = layers?.[def.id]?.visible !== false;
    const lock = layers?.[def.id]?.locked === true;
    panel.append(el("div", { class: "list__row" }, [
      el("strong", { text: def.label }),
      button(vis ? "顯" : "隱", () => app.setWorkbenchLayer(def.id, { visible: !vis }), "chip chip--sm"),
      button(lock ? "鎖" : "解", () => app.setWorkbenchLayer(def.id, { locked: !lock }), "chip chip--sm"),
      button("↑", () => app.reorderWorkbenchLayer(def.id, -1), "chip chip--sm"),
      button("↓", () => app.reorderWorkbenchLayer(def.id, 1), "chip chip--sm"),
    ]));
    panel.append(el("p", { class: "hint", text: def.hint }));
    const rows = grouped[def.id];
    for (const object of rows) {
      const name = object.label ?? object.name ?? assetDef(object.kind).displayName;
      panel.append(el("div", { class: "list__row" }, [
        button(name, () => { app.setSelection([object.id]); app.focusObject(object.id); }, "list__grow chip chip--sm"),
        button(object.hidden ? "顯" : "隱", () => app.setObjectVisibility(object.id, object.hidden), "chip chip--sm"),
        button(object.locked ? "解鎖" : "鎖", () => app.setObjectLocked(object.id, !object.locked), "chip chip--sm"),
        button("↑", () => app.setObjectLayer(object.id, 1), "chip chip--sm"),
        button("↓", () => app.setObjectLayer(object.id, -1), "chip chip--sm"),
      ]));
    }
    if (def.id === "flow") {
      for (const z of state.zones) {
        if (zoneEditorLayer(z) !== "flow") continue;
        panel.append(el("div", { class: "list__row" }, [
          button(`${z.icon ?? ""} ${z.name}`.trim(), () => app.setSelection([z.id]), "list__grow chip chip--sm"),
          button(z.hidden ? "顯" : "隱", () => { app.setSelection([z.id]); app.toggleHideSelection(); }, "chip chip--sm"),
        ]));
      }
    }
  }
  return panel;
}

function buildGroupInspector(root: HTMLElement, app: App, g: NonNullable<ReturnType<App["getSelectedGroup"]>>, advanced: boolean): void {
  const fp = app.groupInfo(g);
  root.append(el("div", { class: "subhead", text: `${assetDef(g.sourceKind).displayName}陣列` }));
  root.append(el("div", { class: "readout" }, [
    el("div", { text: `共 ${fp.count} 個（${g.rows} 列 × ${g.cols} 行）` }),
    el("div", { text: `占用：${fp.totalWidth.toFixed(2)} × ${fp.totalDepth.toFixed(2)} m` }),
    el("div", { text: `編號：${memberLabel(g, 0, 0)} … ${memberLabel(g, g.rows - 1, g.cols - 1)}` }),
  ]));
  root.append(el("div", { class: "grid2" }, [
    num("列數", g.rows, 1, (v) => app.updateSelectedGroup({ rows: Math.max(1, Math.round(v)) }), 1),
    num("行數", g.cols, 1, (v) => app.updateSelectedGroup({ cols: Math.max(1, Math.round(v)) }), 1),
    num("單件寬 (cm)", Math.round(metersToCm(g.itemWidth)), 1, (v) => app.updateSelectedGroup({ itemWidth: v / 100 }), 10),
    num("單件深 (cm)", Math.round(metersToCm(g.itemDepth)), 1, (v) => app.updateSelectedGroup({ itemDepth: v / 100 }), 10),
    num("水平間距 (cm)", Math.round(metersToCm(g.gapX)), 1, (v) => app.updateSelectedGroup({ gapX: v / 100 }), 0),
    num("垂直間距 (cm)", Math.round(metersToCm(g.gapZ)), 1, (v) => app.updateSelectedGroup({ gapZ: v / 100 }), 0),
  ]));
  root.append(nudgePanel(app));
  root.append(el("div", { class: "subhead", text: "編號" }));
  root.append(
    textField("編號前綴", g.numberPrefix, (v) => app.updateSelectedGroup({ numberPrefix: v || "A" })),
    el("div", { class: "grid2" }, [
      selectField("順序", [{ value: "row", label: "先列後行" }, { value: "col", label: "先行後列" }], g.numberOrder, (v) => app.updateSelectedGroup({ numberOrder: v as NumberOrder })),
      selectField("起點", [{ value: "nw", label: "左上" }, { value: "ne", label: "右上" }, { value: "sw", label: "左下" }, { value: "se", label: "右下" }], g.numberStart, (v) => app.updateSelectedGroup({ numberStart: v as NumberStart })),
    ]),
  );
  if (advanced) root.append(num("旋轉 (°)", g.rotationDeg, 5, (v) => app.updateSelectedGroup({ rotationDeg: v })));
  root.append(button("解除群組（改為個別物件）", () => app.ungroupSelected(), "btn btn--ghost"));
}

function buildZoneInspector(root: HTMLElement, app: App, z: NonNullable<ReturnType<App["getSelectedZone"]>>): void {
  root.append(el("div", { class: "subhead", text: `${z.icon ?? ""} 區域：${z.name}` }));
  root.append(section("基本", [
    textField("名稱", z.name, (v) => app.updateSelectedZone({ name: v })),
    selectField("類型", [
      { value: "registration", label: "報到" }, { value: "shoe", label: "鞋子" },
      { value: "backpack", label: "背包" }, { value: "mats", label: "地墊" },
      { value: "meditation", label: "講師" }, { value: "life", label: "生活組" },
      { value: "group", label: "小組" }, { value: "staff", label: "工作人員" },
      { value: "wait", label: "新生等候" }, { value: "custom", label: "自訂" },
    ], z.type, (v) => app.updateSelectedZone({ type: v as typeof z.type })),
    textField("圖示", z.icon ?? "", (v) => app.updateSelectedZone({ icon: v })),
    textField("顏色", z.color, (v) => app.updateSelectedZone({ color: v })),
    textField("說明", z.description ?? "", (v) => app.updateSelectedZone({ description: v })),
  ]));
  root.append(section("尺寸與位置", [
    el("div", { class: "grid2" }, [
      num("寬 (m)", z.width, 0.1, (v) => app.updateSelectedZone({ width: v }), 0.2),
      num("深 (m)", z.depth, 0.1, (v) => app.updateSelectedZone({ depth: v }), 0.2),
      num("高 (m)", z.height ?? 0.02, 0.01, (v) => app.updateSelectedZone({ height: v }), 0),
      num("旋轉 (°)", z.rotationDeg ?? 0, 5, (v) => app.updateSelectedZone({ rotationDeg: v })),
      num("容納人數 (0=不顯示)", z.capacity ?? 0, 1, (v) => app.updateZoneCapacity(v > 0 ? Math.round(v) : null), 0),
    ]),
    nudgePanel(app),
  ]));
  root.append(section("進出與夥伴", [
    textField("入口說明", z.inLabel ?? "", (v) => app.updateSelectedZone({ inLabel: v })),
    textField("出口說明", z.outLabel ?? "", (v) => app.updateSelectedZone({ outLabel: v })),
    button(z.partnerVisible === false ? "場刊隱藏" : "✓ 夥伴可見", () => app.updateSelectedZone({ partnerVisible: z.partnerVisible === false }), "chip chip--sm"),
    button(z.locked ? "解鎖" : "鎖定", () => app.toggleLockSelection(), "chip chip--sm"),
    button(z.hidden ? "顯示" : "隱藏", () => app.toggleHideSelection(), "chip chip--sm"),
    button("複製區域", () => app.duplicateSelection(), "chip chip--sm"),
  ]));
}

function buildRouteInspector(root: HTMLElement, app: App, r: NonNullable<ReturnType<App["getSelectedRoute"]>>): void {
  root.append(el("div", { class: "subhead", text: `動線：${r.name}` }));
  root.append(textField("名稱", r.name, (v) => app.updateRoute(r.id, { name: v })));
  const color = el("input", { type: "color", value: r.color, class: "color" }) as HTMLInputElement;
  color.addEventListener("input", () => app.updateRoute(r.id, { color: color.value }));
  root.append(el("div", { class: "row" }, [
    color,
    button(app.session.activeRouteId === r.id ? "繪製中…" : "繼續繪製", () => app.editRoute(r.id), "chip chip--sm"),
    button(r.visible ? "隱藏" : "顯示", () => app.updateRoute(r.id, { visible: !r.visible }), "chip chip--sm"),
  ]));
  root.append(el("div", { class: "grid2" }, [
    num("粗細 (m)", r.thickness ?? 0.12, 0.02, (v) => app.updateRoute(r.id, { thickness: v }), 0.04),
  ]));
  root.append(el("div", { class: "row wrap" }, [
    button(r.numbered !== false ? "✓ 編號" : "編號", () => app.updateRoute(r.id, { numbered: r.numbered === false }), "chip chip--sm"),
    button(r.showArrows !== false ? "✓ 箭頭" : "箭頭", () => app.updateRoute(r.id, { showArrows: r.showArrows === false }), "chip chip--sm"),
    button(r.partnerVisible === false ? "場刊隱藏" : "✓ 夥伴可見", () => app.updateRoute(r.id, { partnerVisible: r.partnerVisible === false }), "chip chip--sm"),
    button("刪除節點（最後）", () => {
      const pts = r.points.slice(0, -1);
      app.updateRoute(r.id, { points: pts });
    }, "chip chip--sm"),
  ]));
  root.append(el("div", { class: "hint", text: `${r.points.length} 個節點 · 拖曳可改位置` }));
}

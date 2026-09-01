import type { App } from "../app/App";
import { assetDef } from "../core/assets";
import { metersToCm } from "../core/units";
import { buildSummaryLines } from "../core/summary";
import { memberLabel } from "../core/arrays";
import type { NumberOrder, NumberStart } from "../core/model";
import { button, el, num, selectField, textField } from "./dom";

// Nudge step persists across inspector rebuilds.
let nudgeStep = 0.01;

/** Right-side inspector: answers "what have I selected?" — contextual only. */
export function buildInspector(app: App, advanced: boolean, setAdvanced: (v: boolean) => void): HTMLElement {
  const root = el("div", { class: "inspector" });
  const obj = app.getSelectedObject();
  const zone = app.getSelectedZone();
  const group = app.getSelectedGroup();
  const route = app.getSelectedRoute();
  const count = app.session.selection.size;

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
    root.append(el("div", { class: "subhead", text: "對齊 / 分佈" }));
    root.append(el("div", { class: "row wrap" }, [
      button("左", () => app.alignSelection("left"), "chip chip--sm"),
      button("右", () => app.alignSelection("right"), "chip chip--sm"),
      button("上", () => app.alignSelection("top"), "chip chip--sm"),
      button("下", () => app.alignSelection("bottom"), "chip chip--sm"),
      button("水平等距", () => app.distributeSelection("x"), "chip chip--sm"),
      button("垂直等距", () => app.distributeSelection("z"), "chip chip--sm"),
      button("設成群組", () => app.groupSelectedObjects(), "chip chip--sm"),
      button("解除群組", () => app.ungroupSelectedObjects(), "chip chip--sm"),
    ]));
    root.append(nudgePanel(app));
    return root;
  }

  if (obj) buildObjectInspector(root, app, obj, advanced, setAdvanced);
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
    { label: "1cm", v: 0.01 }, { label: "5cm", v: 0.05 },
    { label: "半格", v: tile.width / 2 }, { label: "一格", v: tile.width },
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

function buildObjectInspector(root: HTMLElement, app: App, obj: ReturnType<App["getSelectedObject"]> & object, advanced: boolean, setAdvanced: (v: boolean) => void): void {
  const def = assetDef(obj.kind);
  const prop = app.propForObject(obj.id);
  const info = app.fieldInfo(obj);
  const cm = (m: number) => `${Math.round(m * 100)} cm`;
  // A custom prop degrades to kind "table" so old builds can still place it;
  // that is a storage detail, and showing 「桌子」 with 長桌/方桌 presets to
  // someone who selected their 骰子遊戲站 leaks it into the UI. The presets
  // were worse than confusing: they resized the plan's footprint and never
  // touched the prop.
  root.append(el("div", { class: "subhead", text: prop ? `${prop.icon ?? "▦"} ${prop.name}` : def.displayName }));

  const field = el("div", { class: "readout" }, [
    el("div", { text: info.tileRef }),
    el("div", { text: `尺寸：${info.sizeCm.w} × ${info.sizeCm.d} cm` }),
    el("div", { text: `距牆：左 ${cm(info.wall.west)} · 上 ${cm(info.wall.north)} · 右 ${cm(info.wall.east)} · 下 ${cm(info.wall.south)}` }),
    ...(info.nearestSameKindGap !== null ? [el("div", { text: `最近同類間距：${cm(info.nearestSameKindGap)}` })] : []),
    el("div", { text: `所屬區域：${info.zoneName ?? "（無）"}` }),
  ]);
  if (obj.kind === "door") {
    field.append(el("div", { text: `牆面：${obj.wallAnchor ? edgeName(obj.wallAnchor.edge) : "未貼牆"} · 鉸鏈：${obj.hinge === "right" ? "右" : "左"} · ${obj.openInward === false ? "向外" : "向內"} · ${obj.openDeg ?? 90}°` }));
  }
  root.append(field);
  root.append(button("鏡頭定位", () => { app.scene.focusOn(obj.x, obj.z); }, "chip chip--sm"));

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

  if (!prop && def.presets.length > 1) {
    root.append(el("div", { class: "subhead", text: "常用尺寸" }));
    root.append(el("div", { class: "row wrap" },
      def.presets.map((pr) => button(pr.label, () => app.applyPresetToSelection(pr.id), obj.presetId === pr.id ? "chip chip--sm chip--primary" : "chip chip--sm"))));
  }

  if (obj.kind === "door") {
    root.append(
      selectField("開門邊", [{ value: "left", label: "左鉸鏈" }, { value: "right", label: "右鉸鏈" }], obj.hinge ?? "left", (v) => app.setDoorParams({ hinge: v as "left" | "right" })),
      selectField("方向", [{ value: "in", label: "向內開" }, { value: "out", label: "向外開" }], obj.openInward === false ? "out" : "in", (v) => app.setDoorParams({ openInward: v === "in" })),
      num("開啟角度 (°)", obj.openDeg ?? 90, 5, (v) => app.setDoorParams({ openDeg: v }), 0),
    );
  }
  if (obj.kind === "computer") {
    root.append(button(obj.parentId ? "解除桌面關聯" : "（未在桌面上）", () => app.detachComputer(), "chip chip--sm"));
  }
  if (obj.groupId) {
    root.append(el("div", { class: "row wrap" }, [
      button("選取整個群組", () => app.selectObjectGroup(obj.id), "chip chip--sm"),
      button("從群組移除", () => app.ungroupSelectedObjects(), "chip chip--sm"),
    ]));
  }

  const labelPos = obj.labelPosition ?? { offsetX: 0, offsetY: 0, offsetZ: 0 };
  if (obj.assetId) {
    root.append(button(
      app.isAssetFavorite(obj.assetId) ? "★ 已收藏這個素材" : "☆ 收藏這個素材",
      () => app.toggleAssetFavorite(obj.assetId!),
      "chip chip--sm",
    ));
  }
  root.append(el("div", { class: "subhead", text: "標注（不影響物件本體）" }));
  root.append(el("div", { class: "row wrap" }, [
    button(obj.showLabel === false ? "顯示此標注" : "隱藏此標注", () => app.updateSelectedLabel({ showLabel: obj.showLabel === false }), "chip chip--sm"),
    button("只看選取標注", () => app.setLabelDisplayMode("selected"), "chip chip--sm"),
  ]));
  root.append(textField("畫面標注", obj.label ?? obj.name ?? def.displayName, (v) => app.updateSelectedLabel({ label: v })));
  root.append(el("div", { class: "grid2" }, [
    num("標注左右 cm", Math.round(labelPos.offsetX * 100), 1, (v) => app.updateSelectedLabel({ labelPosition: { ...labelPos, offsetX: v / 100 } }), -500),
    num("標注前後 cm", Math.round(labelPos.offsetZ * 100), 1, (v) => app.updateSelectedLabel({ labelPosition: { ...labelPos, offsetZ: v / 100 } }), -500),
    num("標注高度 cm", Math.round(labelPos.offsetY * 100), 1, (v) => app.updateSelectedLabel({ labelPosition: { ...labelPos, offsetY: v / 100 } }), -500),
    num("標注字級", obj.labelStyle?.fontSize ?? 26, 1, (v) => app.updateSelectedLabel({ labelStyle: { ...obj.labelStyle, fontSize: v } }), 10),
    textField("文字色（#RRGGBB）", obj.labelStyle?.color ?? "#f8fafc", (v) => app.updateSelectedLabel({ labelStyle: { ...obj.labelStyle, color: v } })),
    textField("標注底色（#RRGGBB）", obj.labelStyle?.background ?? "#172033", (v) => app.updateSelectedLabel({ labelStyle: { ...obj.labelStyle, background: v } })),
  ]));

  propStationPanel(root, app, obj.id);

  if (obj.surface !== "wall") root.append(rotationPanel(app, obj.rotationDeg));
  root.append(nudgePanel(app));

  root.append(advancedToggle(advanced, setAdvanced));
  if (advanced) {
    root.append(el("div", { class: "grid2" }, [
      num("寬 (cm)", info.sizeCm.w, 1, (v) => app.updateSelectedObject({ width: v / 100 }), 5),
      num("深 (cm)", info.sizeCm.d, 1, (v) => app.updateSelectedObject({ depth: v / 100 }), 5),
      num("整體縮放 (%)", Math.round((obj.scale ?? 1) * 100), 1, (v) => app.setSelectedScale(v / 100), 10),
      num("旋轉 (°)", obj.rotationDeg, 5, (v) => app.updateSelectedObject({ rotationDeg: v })),
      num("離地 (cm)", Math.round(metersToCm(obj.elevation)), 1, (v) => app.updateSelectedObject({ elevation: v / 100 }), 0),
    ]));
    const surfaceLabel = obj.surface === "wall" ? "牆面" : obj.surface === "tabletop" ? "桌面" : "地面";
    root.append(el("div", { class: "readout" }, [
      el("div", { text: `X / Z：${obj.x.toFixed(3)}, ${obj.z.toFixed(3)} m` }),
      el("div", { text: `放置面：${surfaceLabel}` }),
    ]));
    root.append(textField("備註", obj.note ?? "", (v) => app.updateSelectedObject({ note: v })));
    root.append(textField("工作名稱", obj.name ?? def.displayName, (v) => app.renameSelectedObject(v)));
    root.append(el("div", { class: "row wrap" }, [
      button("圖層往前", () => app.setObjectLayer(obj.id, 1), "chip chip--sm"),
      button("圖層往後", () => app.setObjectLayer(obj.id, -1), "chip chip--sm"),
      el("span", { class: "hint", text: `圖層 ${obj.layer ?? 0}` }),
    ]));
    if (obj.surface === "tabletop") {
      root.append(button(
        obj.allowTabletopOverflow ? "限制在桌面內" : "允許超出桌緣",
        () => app.updateSelectedObject({ allowTabletopOverflow: !obj.allowTabletopOverflow }),
        "chip chip--sm",
      ));
    }
  }
}

/** A compact persistent object/layer list. It deliberately uses the same App
 * mutators as canvas interactions, so visibility and lock state are saved,
 * undoable, and never become a UI-only shadow copy. */
function buildObjectLayerPanel(app: App): HTMLElement {
  const state = app.store.getState();
  const rows = [...state.objects]
    .sort((a, b) => (b.layer ?? 0) - (a.layer ?? 0) || (b.createdAt ?? 0) - (a.createdAt ?? 0));
  const panel = el("div", { class: "list" });
  panel.append(el("div", { class: "subhead", text: "物件與圖層" }));
  if (!rows.length) {
    panel.append(el("p", { class: "hint", text: "還沒有物件。先放一張桌子，再進入桌面佈置。" }));
    return panel;
  }
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
  root.append(
    textField("名稱", z.name, (v) => app.updateSelectedZone({ name: v })),
    el("div", { class: "grid2" }, [
      num("寬 (m)", z.width, 0.1, (v) => app.updateSelectedZone({ width: v }), 0.2),
      num("深 (m)", z.depth, 0.1, (v) => app.updateSelectedZone({ depth: v }), 0.2),
      num("容納人數 (0=不顯示)", z.capacity ?? 0, 1, (v) => app.updateZoneCapacity(v > 0 ? Math.round(v) : null), 0),
    ]),
  );
  root.append(nudgePanel(app));
}

function buildRouteInspector(root: HTMLElement, app: App, r: NonNullable<ReturnType<App["getSelectedRoute"]>>): void {
  root.append(el("div", { class: "subhead", text: `動線：${r.name}` }));
  root.append(textField("名稱", r.name, (v) => app.updateRoute(r.id, { name: v })));
  const color = el("input", { type: "color", value: r.color, class: "color" }) as HTMLInputElement;
  color.addEventListener("input", () => app.updateRoute(r.id, { color: color.value }));
  root.append(el("div", { class: "row" }, [color, button(app.session.activeRouteId === r.id ? "繪製中…" : "繼續繪製", () => app.editRoute(r.id), "chip chip--sm"), button(r.visible ? "隱藏" : "顯示", () => app.updateRoute(r.id, { visible: !r.visible }), "chip chip--sm")]));
  root.append(el("div", { class: "hint", text: `${r.points.length} 個節點` }));
}

function edgeName(edge: string): string {
  return ({ n: "教室北側", s: "教室南側", e: "教室東側", w: "教室西側" } as Record<string, string>)[edge] ?? edge;
}

function advancedToggle(advanced: boolean, setAdvanced: (v: boolean) => void): HTMLElement {
  return button(advanced ? "▾ 隱藏進階" : "▸ 進階（精準參數）", () => setAdvanced(!advanced), "chip chip--sm");
}

import type { App } from "../app/App";
import { assetDef } from "../core/assets";
import { metersToCm } from "../core/units";
import { buildSummaryLines } from "../core/summary";
import { button, el, num, selectField, textField } from "./dom";

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
    root.append(box, el("p", { class: "hint", text: "從左側素材庫選一個素材開始擺放，或點選場景中的物件查看資訊。" }));
    return root;
  }

  // Common action row.
  root.append(el("div", { class: "toolrow" }, [
    button("旋轉", () => app.rotateSelection(15), "chip chip--sm"),
    button("複製", () => app.duplicateSelection(), "chip chip--sm"),
    button("鎖定", () => app.toggleLockSelection(), "chip chip--sm"),
    button("隱藏", () => app.toggleHideSelection(), "chip chip--sm"),
    button("刪除", () => app.deleteSelection(), "chip chip--sm chip--danger"),
  ]));

  if (count > 1) {
    root.append(el("div", { text: `已選取 ${count} 個項目` }));
    return root;
  }

  if (obj) buildObjectInspector(root, app, obj, advanced, setAdvanced);
  else if (group) buildGroupInspector(root, app, group, advanced);
  else if (zone) buildZoneInspector(root, app, zone);
  else if (route) buildRouteInspector(root, app, route);
  return root;
}

function buildObjectInspector(root: HTMLElement, app: App, obj: ReturnType<App["getSelectedObject"]> & object, advanced: boolean, setAdvanced: (v: boolean) => void): void {
  const def = assetDef(obj.kind);
  const info = app.fieldInfo(obj);
  root.append(el("div", { class: "subhead", text: `${def.displayName}` }));

  // Field info — plain language first.
  const field = el("div", { class: "readout" }, [
    el("div", { text: info.tileRef }),
    el("div", { text: `尺寸：${info.sizeCm.w} × ${info.sizeCm.d} cm` }),
    el("div", { text: `距最近牆：${(info.distToNearestWall * 100).toFixed(0)} cm` }),
    el("div", { text: `所屬區域：${info.zoneName ?? "（無）"}` }),
  ]);
  root.append(field);
  root.append(button("鏡頭定位", () => { app.scene.focusOn(obj.x, obj.z); }, "chip chip--sm"));

  // Presets.
  if (def.presets.length > 1) {
    root.append(el("div", { class: "row wrap" },
      def.presets.map((pr) => button(pr.label, () => app.applyPresetToSelection(pr.id), obj.presetId === pr.id ? "chip chip--sm chip--primary" : "chip chip--sm"))));
  }

  // Contextual actions.
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

  // Advanced.
  root.append(advancedToggle(advanced, setAdvanced));
  if (advanced) {
    root.append(el("div", { class: "grid2" }, [
      num("寬 (cm)", info.sizeCm.w, 1, (v) => app.updateSelectedObject({ width: v / 100 }), 5),
      num("深 (cm)", info.sizeCm.d, 1, (v) => app.updateSelectedObject({ depth: v / 100 }), 5),
      num("旋轉 (°)", obj.rotationDeg, 5, (v) => app.updateSelectedObject({ rotationDeg: v })),
      num("離地 (cm)", Math.round(metersToCm(obj.elevation)), 1, (v) => app.updateSelectedObject({ elevation: v / 100 }), 0),
    ]));
    root.append(el("div", { class: "readout" }, [
      el("div", { text: `X / Z：${obj.x.toFixed(3)}, ${obj.z.toFixed(3)} m` }),
      el("div", { text: `放置面：${obj.surface}` }),
    ]));
    root.append(textField("備註", obj.note ?? "", (v) => app.updateSelectedObject({ note: v })));
  }
}

function buildGroupInspector(root: HTMLElement, app: App, g: NonNullable<ReturnType<App["getSelectedGroup"]>>, advanced: boolean): void {
  const fp = app.groupInfo(g);
  root.append(el("div", { class: "subhead", text: `${assetDef(g.sourceKind).displayName}陣列` }));
  root.append(el("div", { class: "readout" }, [
    el("div", { text: `共 ${fp.count} 個（${g.rows} 列 × ${g.cols} 行）` }),
    el("div", { text: `占用：${fp.totalWidth.toFixed(2)} × ${fp.totalDepth.toFixed(2)} m` }),
  ]));
  root.append(el("div", { class: "grid2" }, [
    num("列數", g.rows, 1, (v) => app.updateSelectedGroup({ rows: Math.max(1, Math.round(v)) }), 1),
    num("行數", g.cols, 1, (v) => app.updateSelectedGroup({ cols: Math.max(1, Math.round(v)) }), 1),
    num("墊寬 (cm)", Math.round(metersToCm(g.itemWidth)), 1, (v) => app.updateSelectedGroup({ itemWidth: v / 100 }), 10),
    num("墊深 (cm)", Math.round(metersToCm(g.itemDepth)), 1, (v) => app.updateSelectedGroup({ itemDepth: v / 100 }), 10),
    num("水平間距 (cm)", Math.round(metersToCm(g.gapX)), 1, (v) => app.updateSelectedGroup({ gapX: v / 100 }), 0),
    num("垂直間距 (cm)", Math.round(metersToCm(g.gapZ)), 1, (v) => app.updateSelectedGroup({ gapZ: v / 100 }), 0),
  ]));
  if (advanced) root.append(num("旋轉 (°)", g.rotationDeg, 5, (v) => app.updateSelectedGroup({ rotationDeg: v })));
  root.append(button("解除群組（改為個別物件）", () => app.ungroupSelected(), "btn btn--ghost"));
}

function buildZoneInspector(root: HTMLElement, app: App, z: NonNullable<ReturnType<App["getSelectedZone"]>>): void {
  root.append(el("div", { class: "subhead", text: `區域：${z.name}` }));
  root.append(
    textField("名稱", z.name, (v) => app.updateSelectedZone({ name: v })),
    el("div", { class: "grid2" }, [
      num("寬 (m)", z.width, 0.1, (v) => app.updateSelectedZone({ width: v }), 0.2),
      num("深 (m)", z.depth, 0.1, (v) => app.updateSelectedZone({ depth: v }), 0.2),
    ]),
  );
}

function buildRouteInspector(root: HTMLElement, app: App, r: NonNullable<ReturnType<App["getSelectedRoute"]>>): void {
  root.append(el("div", { class: "subhead", text: `動線：${r.name}` }));
  root.append(textField("名稱", r.name, (v) => app.updateRoute(r.id, { name: v })));
  const color = el("input", { type: "color", value: r.color, class: "color" }) as HTMLInputElement;
  color.addEventListener("input", () => app.updateRoute(r.id, { color: color.value }));
  root.append(el("div", { class: "row" }, [color, button(app.session.activeRouteId === r.id ? "繪製中…" : "繼續繪製", () => app.editRoute(r.id), "chip chip--sm"), button(r.visible ? "隱藏" : "顯示", () => app.updateRoute(r.id, { visible: !r.visible }), "chip chip--sm")]));
  root.append(el("div", { class: "hint", text: `${r.points.length} 個節點` }));
}

function advancedToggle(advanced: boolean, setAdvanced: (v: boolean) => void): HTMLElement {
  return button(advanced ? "▾ 隱藏進階" : "▸ 進階（精準參數）", () => setAdvanced(!advanced), "chip chip--sm");
}

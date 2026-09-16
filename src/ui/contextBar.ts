/**
 * Selection Context Bar — the compact answer to "I tapped a thing".
 *
 * Phone/tablet must NOT throw the full inspector over the canvas. The bar now
 * shows name, type, W/D/H, facing, zone and lock/snap/circulation at a glance;
 * the three repeat actions stay 旋轉 / 複製 / 屬性 so the compact contract holds.
 */

import type { App } from "../app/App";
import { assetDef } from "../core/assets";
import { button, el } from "./dom";
import { facingLabel, formatSize, objectWorkbenchSummary } from "../core/objectWorkbench";

export interface ContextBarModel {
  name: string;
  size: string;
  meta?: string;
  flags?: string;
}

/** Human-readable name + footprint for whatever is selected, or null. */
export function contextBarModel(app: App): ContextBarModel | null {
  const count = app.session.selection.size;
  if (count === 0) return null;
  if (count > 1) return { name: `已選 ${count} 個`, size: "多選", meta: "對齊 / 分佈 / 群組在屬性" };

  const obj = app.getSelectedObject();
  if (obj) {
    const tabletop = app.tabletopHost;
    const summary = objectWorkbenchSummary(obj, app.store.getState());
    const objectName = summary.name;
    return {
      name: tabletop ? `場景 > ${tabletop.name ?? assetDef(tabletop.kind).displayName} > 桌面 · ${objectName}` : objectName,
      size: formatSize(obj, "cm"),
      meta: `${summary.type} · ${facingLabel(obj.rotationDeg)} · ${summary.zoneName ?? "未分區"}`,
      flags: [
        obj.locked ? "鎖" : null,
        obj.hidden ? "隱" : null,
        obj.snapEnabled === false ? "自由" : "吸附",
        summary.blocksCirculation ? "擋路" : null,
      ].filter(Boolean).join(" · "),
    };
  }
  const group = app.getSelectedGroup();
  if (group) {
    const fp = app.groupInfo(group);
    return {
      name: `${assetDef(group.sourceKind).displayName}陣列`,
      size: `${fp.count} 個 · ${fp.totalWidth.toFixed(1)}×${fp.totalDepth.toFixed(1)} m`,
    };
  }
  const zone = app.getSelectedZone();
  if (zone) {
    return { name: zone.name, size: `${zone.width.toFixed(1)}×${zone.depth.toFixed(1)} m`, meta: zone.type };
  }
  const route = app.getSelectedRoute();
  if (route) return { name: route.name, size: `${route.points.length} 節點` };
  return { name: "已選取", size: "" };
}

export interface ContextBarOptions {
  /** Opens the inspector sheet/drawer — the only path to the full editor. */
  onOpenProperties: () => void;
}

export function renderContextBar(host: HTMLElement, app: App, opts: ContextBarOptions): void {
  const model = contextBarModel(app);
  host.innerHTML = "";
  if (!model) return;
  const selectedObject = app.getSelectedObject();
  const tabletopAction = selectedObject && (selectedObject.kind === "table" || selectedObject.kind === "regTable")
    ? [button(app.tabletopHost?.id === selectedObject.id ? "離開桌面" : "桌面", () => {
      if (app.tabletopHost?.id === selectedObject.id) app.exitTabletopLayout();
      else app.enterTabletopLayout();
    }, "chip chip--sm chip--primary")]
    : [];
  host.append(
      el("span", { class: "ctxbar__info" }, [
        el("span", { class: "ctxbar__name", text: model.name }),
        el("span", { class: "ctxbar__size", text: model.size }),
        ...(model.meta ? [el("span", { class: "ctxbar__meta", text: model.meta })] : []),
        ...(model.flags ? [el("span", { class: "ctxbar__flags", text: model.flags })] : []),
      ]),
      ...(tabletopAction.length ? [el("span", { class: "ctxbar__tabletop" }, tabletopAction)] : []),
      el("span", { class: "ctxbar__actions" }, [
        button("旋轉", () => app.rotateSelection(15), "chip chip--sm"),
        button("複製", () => app.duplicateSelection(), "chip chip--sm"),
        button("屬性", () => opts.onOpenProperties(), "chip chip--sm chip--primary"),
      ]),
  );
}

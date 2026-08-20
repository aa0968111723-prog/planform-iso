/**
 * Photo / GLB custom asset creation — compact sheet content for library panel.
 */

import type { App } from "../app/App";
import { createCustomAssetProxy, guessSemanticFromName } from "../assets/proxy";
import { importGltfAsset } from "../assets/importGltf";
import {
  MockReconstructionWorker,
  ReconstructionQueue,
} from "../assets/reconstruction";
import type { SemanticAssetType, ServiceRole } from "../core/catalog";
import { button, el, section } from "./dom";

export function buildCustomAssetFlow(app: App): HTMLElement {
  const status = el("div", { class: "hint", text: "拍照或匯入 GLB，立即得到可放進場佈的素材。" });
  const nameInput = el("input", { type: "text", class: "field__input", placeholder: "名稱（如：收費桌）" }) as HTMLInputElement;
  const wInput = el("input", { type: "number", class: "field__input", value: "180", step: "1" }) as HTMLInputElement;
  const dInput = el("input", { type: "number", class: "field__input", value: "60", step: "1" }) as HTMLInputElement;
  const hInput = el("input", { type: "number", class: "field__input", value: "74", step: "1" }) as HTMLInputElement;
  const roleSel = el("select", { class: "field__input" }) as HTMLSelectElement;
  for (const [v, label] of [
    ["none", "一般"],
    ["checkin", "報到"],
    ["payment", "收費"],
    ["guidance", "引導"],
    ["storage", "收納"],
  ] as const) {
    roleSel.append(el("option", { value: v, text: label }));
  }

  const photoInput = el("input", {
    type: "file",
    accept: "image/*",
    capture: "environment",
    style: "display:none",
  }) as HTMLInputElement;
  const glbInput = el("input", {
    type: "file",
    accept: ".glb,.gltf,model/gltf-binary,model/gltf+json",
    style: "display:none",
  }) as HTMLInputElement;

  photoInput.addEventListener("change", () => void onPhoto());
  glbInput.addEventListener("change", () => void onGlb());

  async function onPhoto(): Promise<void> {
    const file = photoInput.files?.[0];
    if (!file) return;
    status.textContent = "建立簡化素材中…";
    const buf = await file.arrayBuffer();
    const name = nameInput.value.trim() || file.name.replace(/\.[^.]+$/, "") || "自訂素材";
    const guessed = guessSemanticFromName(name);
    const role = (roleSel.value as ServiceRole) || guessed.serviceRole;
    const semanticType: SemanticAssetType =
      role === "payment" || role === "checkin" ? "service-desk" : guessed.semanticType;
    const { entry } = await createCustomAssetProxy({
      name,
      semanticType,
      serviceRole: role,
      dimensions: {
        width: Number(wInput.value) / 100 || 1.2,
        depth: Number(dInput.value) / 100 || 0.6,
        height: Number(hInput.value) / 100 || 0.74,
      },
      sourceImage: buf,
      sourceMimeType: file.type || "image/jpeg",
    });
    app.upsertCatalogEntry(entry);
    status.textContent = "精緻模型稍後產生，目前可先用簡化素材排場佈。";
    app.notifyToast?.(status.textContent);
    app.beginPlacementByAssetId(entry.id);

    // Kick mock reconstruction in background.
    const queue = new ReconstructionQueue();
    const job = queue.enqueue(entry.id, entry.blobIds?.sourceImage);
    const worker = new MockReconstructionWorker(queue);
    void worker.run(job.id, entry).then(({ entry: next }) => {
      app.upsertCatalogEntry(next);
      app.notifyToast?.("精緻模型已替換完成");
    }).catch(() => {
      /* keep proxy */
    });
  }

  async function onGlb(): Promise<void> {
    const file = glbInput.files?.[0];
    if (!file) return;
    status.textContent = "分析 / 最佳化模型中…";
    const data = await file.arrayBuffer();
    const role = roleSel.value as ServiceRole;
    const dims = {
      width: Number(wInput.value) / 100,
      depth: Number(dInput.value) / 100,
      height: Number(hInput.value) / 100,
    };
    const result = await importGltfAsset({
      fileName: file.name,
      data,
      name: nameInput.value.trim() || undefined,
      semanticType: role === "payment" || role === "checkin" ? "service-desk" : "other",
      serviceRole: role,
      dimensions:
        Number.isFinite(dims.width) && dims.width > 0
          ? dims
          : undefined,
    });
    if (!result.ok || !result.entry) {
      status.textContent = result.error ?? "匯入失敗";
      return;
    }
    app.upsertCatalogEntry(result.entry);
    status.textContent = result.report?.passMobile
      ? `已匯入「${result.entry.name}」`
      : `已匯入（已最佳化）：${result.entry.name}`;
    app.beginPlacementByAssetId(result.entry.id);
  }

  return section("我的素材", [
    status,
    el("label", { class: "field" }, [el("span", { class: "field__label", text: "名稱" }), nameInput]),
    el("div", { class: "grid2" }, [
      el("label", { class: "field" }, [el("span", { class: "field__label", text: "寬 cm" }), wInput]),
      el("label", { class: "field" }, [el("span", { class: "field__label", text: "深 cm" }), dInput]),
      el("label", { class: "field" }, [el("span", { class: "field__label", text: "高 cm" }), hInput]),
      el("label", { class: "field" }, [el("span", { class: "field__label", text: "用途" }), roleSel]),
    ]),
    el("div", { class: "row wrap", style: "gap:6px;margin-top:8px" }, [
      button("📷 拍照建立", () => photoInput.click(), "btn"),
      button("匯入 3D 素材", () => glbInput.click(), "btn btn--ghost"),
    ]),
    photoInput,
    glbInput,
  ]);
}

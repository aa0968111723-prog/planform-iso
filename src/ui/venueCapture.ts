/**
 * Venue Capture UI — photo upload → review detections → calibrate → commit.
 *
 * NOT MOUNTED IN PRODUCTION, and the reason matters.
 *
 * The only `VenueProvider` that exists is `MockVenueProvider`, which throws the
 * photograph away (`void _dataUrl`) and derives six "detections" from
 * `imageName.length % 7` — four of them `confirmed: true`. Mounted, this asked
 * a volunteer standing in E310 to photograph the real room and answered with
 * 門 82% / 投影幕 71% / 桌子 64% / 報到桌 58%, none of which came from their
 * photo, then wrote those four invented objects into the plan the setup team
 * would follow. Two different photos with equal-length filenames produced
 * byte-identical results; the same photo renamed produced different ones.
 *
 * The flow could not be used honestly even in principle: the captured photo is
 * never drawn, so the two-point calibration it asks for cannot be aimed at
 * anything — the reference line is hard-coded to (0.1,0.9)→(0.4,0.9).
 *
 * So the machinery stays (session, calibration, commit are all real and
 * tested), and the switch is a single binding: give `provider` a real vision
 * provider and the section appears again, with no other change.
 */

import type { App } from "../app/App";
import {
  applyVenueCalibration,
  createVenueSession,
  type VenueCaptureSession,
  type VenueDetection,
  type VenueProvider,
} from "../assets/venueCapture";
import { button, el, section } from "./dom";

/**
 * The vision provider. `null` until a real one exists — a mock must never be
 * wired here, because everything downstream treats a detection as observed.
 */
const provider: VenueProvider | null = null;

/** Whether 掃描場地 may be offered to a user at all. */
export function venueCaptureAvailable(): boolean {
  return provider !== null;
}

export function buildVenueCaptureFlow(app: App): HTMLElement {
  const host = el("div", { class: "venue-capture" });
  let session: VenueCaptureSession | null = null;

  const fileInput = el("input", {
    type: "file",
    accept: "image/*",
    capture: "environment",
    style: "display:none",
  }) as HTMLInputElement;

  const body = el("div", { class: "venue-capture__body" });

  const render = () => {
    body.innerHTML = "";
    if (!session) {
      body.append(
        el("p", {
          class: "hint",
          text: "拍攝或上傳場地照片 → 檢視偵測 → 校正比例 → 確認後才寫入場佈（可復原）。",
        }),
        button("📷 掃描場地", () => fileInput.click(), "btn"),
      );
      return;
    }

    const list = el("div", { class: "list" });
    for (const d of session.detections) {
      list.append(detectionRow(d, () => {
        d.confirmed = !d.confirmed;
        render();
      }, () => {
        // cycle kind lightly for review
        const order: VenueDetection["kind"][] = ["door", "screen", "table", "chair", "regTable", "obstacle", "tile-hint"];
        const kindLabel: Record<VenueDetection["kind"], string> = {
          door: "門", screen: "投影幕", table: "桌子", chair: "椅子",
          regTable: "報到桌", obstacle: "障礙物", "tile-hint": "地磚參考",
        };
        const i = order.indexOf(d.kind);
        d.kind = order[(i + 1) % order.length];
        d.label = kindLabel[d.kind] ?? d.kind;
        d.needsReview = true;
        render();
      }));
    }

    const calibInput = el("input", {
      type: "number",
      step: "1",
      class: "field__input",
      placeholder: "兩點實際距離 (cm)",
      value: session.calibMeters ? String(Math.round(session.calibMeters * 100)) : "",
    }) as HTMLInputElement;

    body.append(
      el("div", { class: "subhead", text: `偵測：${session.imageName}` }),
      el("p", {
        class: "hint",
        text: session.scale
          ? `已校正：1 圖單位 ≈ ${(session.scale * 100).toFixed(0)} cm（沿參考線）`
          : "請輸入畫面參考線（預設底邊 30% 寬）的實際距離後套用校正。",
      }),
      list,
      el("div", { class: "row" }, [
        calibInput,
        button("套用校正", () => {
          const cm = parseFloat(calibInput.value);
          if (!cm || cm <= 0) {
            app.onToast?.("請輸入有效距離 (cm)");
            return;
          }
          session = applyVenueCalibration(session!, cm / 100);
          app.onToast?.(session.scale ? "已套用校正" : "校正失敗");
          render();
        }, "chip chip--sm chip--primary"),
      ]),
      el("div", { class: "row wrap" }, [
        button("確認寫入", () => {
          if (!session) return;
          const n = app.commitVenueCapture(session);
          if (n > 0) {
            session = null;
            render();
          }
        }, "btn btn--primary"),
        button("取消", () => {
          session = null;
          render();
        }, "btn btn--ghost"),
      ]),
    );
  };

  fileInput.addEventListener("change", async () => {
    const f = fileInput.files?.[0];
    fileInput.value = "";
    if (!f) return;
    const dataUrl = await readAsDataUrl(f);
    if (!provider) return;
    const detections = await provider.detect(f.name, dataUrl);
    session = createVenueSession(f.name, dataUrl, detections);
    render();
  });

  host.append(fileInput, body);
  render();
  return section("📷 掃描場地", [host]);
}

function detectionRow(
  d: VenueDetection,
  onToggle: () => void,
  onCycle: () => void,
): HTMLElement {
  const conf = Math.round(d.confidence * 100);
  const warn = d.needsReview || d.confidence < 0.6;
  return el("div", { class: `list__row ${warn ? "issue--warning" : ""}` }, [
    el("span", {
      text: `${d.confirmed ? "✓" : "○"} ${d.label} ${conf}%${warn ? " · 待確認" : ""}`,
    }),
    button(d.confirmed ? "排除" : "採用", onToggle, "chip chip--sm"),
    button("改類型", onCycle, "chip chip--sm"),
  ]);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

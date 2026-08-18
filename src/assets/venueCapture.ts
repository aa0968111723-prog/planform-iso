/**
 * Venue Capture — photo → semantic detections → user confirm → SceneObjects.
 *
 * V1 uses a deterministic MockVenueProvider (and optional future vision
 * providers). Nothing is written to the project until the user confirms.
 */

import {
  uid,
  type ObjectKind,
  type Project,
  type SceneObject,
  type ServiceRole,
} from "../core/model";

export type VenueDetectionKind =
  | "door"
  | "screen"
  | "table"
  | "chair"
  | "regTable"
  | "obstacle"
  | "tile-hint";

export interface VenueDetection {
  id: string;
  kind: VenueDetectionKind;
  label: string;
  /** Normalized image coords 0–1 (top-left origin). */
  nx: number;
  nz: number;
  /** Suggested real footprint meters. */
  width: number;
  depth: number;
  height: number;
  confidence: number;
  confirmed: boolean;
  needsReview: boolean;
  serviceRole?: ServiceRole;
}

export interface VenueCaptureSession {
  id: string;
  imageName: string;
  imageDataUrl: string | null;
  detections: VenueDetection[];
  /** Two-point calibration in normalized image space. */
  calibA: { nx: number; nz: number } | null;
  calibB: { nx: number; nz: number } | null;
  /** Actual meters for A→B. */
  calibMeters: number | null;
  /** Meters per normalized image unit along X (after calib). */
  scale: number | null;
}

export interface VenueProvider {
  readonly id: string;
  detect(imageName: string, dataUrl: string | null): Promise<VenueDetection[]>;
}

/** Deterministic mock detections for offline / tests / no-vision environments. */
export class MockVenueProvider implements VenueProvider {
  readonly id = "mock-venue";

  async detect(imageName: string, _dataUrl: string | null): Promise<VenueDetection[]> {
    void _dataUrl;
    // Seed positions from filename length so different photos look different but stable.
    const seed = imageName.length % 7;
    const base: Omit<VenueDetection, "id">[] = [
      {
        kind: "door",
        label: "門",
        nx: 0.15 + seed * 0.01,
        nz: 0.85,
        width: 0.9,
        depth: 0.12,
        height: 2.1,
        confidence: 0.82,
        confirmed: true,
        needsReview: false,
      },
      {
        kind: "screen",
        label: "投影幕",
        nx: 0.5,
        nz: 0.12,
        width: 2.4,
        depth: 0.08,
        height: 1.5,
        confidence: 0.71,
        confirmed: true,
        needsReview: false,
      },
      {
        kind: "table",
        label: "桌子",
        nx: 0.35,
        nz: 0.55,
        width: 1.2,
        depth: 0.6,
        height: 0.74,
        confidence: 0.64,
        confirmed: true,
        needsReview: false,
      },
      {
        kind: "regTable",
        label: "報到桌",
        nx: 0.7,
        nz: 0.7,
        width: 1.5,
        depth: 0.7,
        height: 0.74,
        confidence: 0.58,
        confirmed: true,
        needsReview: true,
        serviceRole: "checkin",
      },
      {
        kind: "chair",
        label: "椅子",
        nx: 0.4,
        nz: 0.65,
        width: 0.45,
        depth: 0.45,
        height: 0.9,
        confidence: 0.45,
        confirmed: false,
        needsReview: true,
      },
      {
        kind: "tile-hint",
        label: "地磚參考",
        nx: 0.2,
        nz: 0.4,
        width: 0.6,
        depth: 0.6,
        height: 0.01,
        confidence: 0.55,
        confirmed: false,
        needsReview: true,
      },
    ];
    return base.map((d, i) => ({ ...d, id: `det_${i}_${seed}` }));
  }
}

export function createVenueSession(
  imageName: string,
  imageDataUrl: string | null,
  detections: VenueDetection[],
): VenueCaptureSession {
  return {
    id: uid("cap"),
    imageName,
    imageDataUrl,
    detections,
    calibA: { nx: 0.1, nz: 0.9 },
    calibB: { nx: 0.4, nz: 0.9 },
    calibMeters: null,
    scale: null,
  };
}

/** Apply known distance between calib A/B → meters per normalized unit. */
export function applyVenueCalibration(
  session: VenueCaptureSession,
  actualMeters: number,
): VenueCaptureSession {
  if (!session.calibA || !session.calibB || actualMeters <= 0) return session;
  const dn = Math.hypot(
    session.calibB.nx - session.calibA.nx,
    session.calibB.nz - session.calibA.nz,
  );
  if (dn < 1e-6) return session;
  return {
    ...session,
    calibMeters: actualMeters,
    scale: actualMeters / dn,
  };
}

function kindToObjectKind(k: VenueDetectionKind): ObjectKind | null {
  switch (k) {
    case "door":
    case "screen":
    case "table":
    case "chair":
    case "regTable":
      return k;
    default:
      return null;
  }
}

/**
 * Convert confirmed detections into SceneObjects placed relative to classroom.
 * Requires calibration scale. Low-confidence items keep note「待確認」.
 */
export function detectionsToObjects(
  session: VenueCaptureSession,
  project: Project,
): { objects: SceneObject[]; skipped: string[] } {
  const skipped: string[] = [];
  if (!session.scale) {
    return { objects: [], skipped: ["尚未校正比例（請輸入兩點實際距離）"] };
  }
  const room = project.classroom;
  const objects: SceneObject[] = [];
  for (const d of session.detections) {
    if (!d.confirmed) continue;
    const kind = kindToObjectKind(d.kind);
    if (!kind) {
      skipped.push(`${d.label}（參考用，未寫入物件）`);
      continue;
    }
    const x = room.x + d.nx * room.length;
    const z = room.z + d.nz * room.width;
    const obj: SceneObject = {
      id: uid("obj"),
      kind,
      x,
      z,
      rotationDeg: kind === "door" || kind === "screen" ? 180 : 0,
      width: d.width,
      depth: d.depth,
      height: d.height,
      locked: false,
      hidden: false,
      surface: kind === "door" || kind === "screen" ? "wall" : "floor",
      elevation: kind === "screen" ? 1.0 : 0,
      assetId: `builtin:${kind}`,
      serviceRole: d.serviceRole,
      note: d.needsReview || d.confidence < 0.6 ? "待確認（掃描場地）" : "掃描場地",
      hinge: kind === "door" ? "left" : undefined,
      openInward: kind === "door" ? true : undefined,
      openDeg: kind === "door" ? 90 : undefined,
    };
    objects.push(obj);
  }
  return { objects, skipped };
}

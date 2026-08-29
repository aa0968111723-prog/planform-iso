/**
 * Local venue vision — analyse a photo's pixels (not the filename).
 *
 * Heuristics only: bright top band → screen, dark edge → door, mid blobs →
 * tables. Not a cloud vision model. No image → caller should fall back to mock.
 */

import { MockVenueProvider, type VenueDetection, type VenueProvider } from "./venueCapture";

export function lumaAt(data: Uint8ClampedArray, width: number, x: number, y: number): number {
  const i = (y * width + x) * 4;
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}

export function bandLuma(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const xa = Math.max(0, Math.min(width, Math.floor(x0)));
  const xb = Math.max(0, Math.min(width, Math.ceil(x1)));
  const ya = Math.max(0, Math.min(height, Math.floor(y0)));
  const yb = Math.max(0, Math.min(height, Math.ceil(y1)));
  if (xb <= xa || yb <= ya) return 0;
  let sum = 0;
  let n = 0;
  const stepX = Math.max(1, Math.floor((xb - xa) / 24));
  const stepY = Math.max(1, Math.floor((yb - ya) / 16));
  for (let y = ya; y < yb; y += stepY) {
    for (let x = xa; x < xb; x += stepX) {
      sum += lumaAt(data, width, x, y);
      n += 1;
    }
  }
  return n ? sum / n : 0;
}

function brightestX(
  data: Uint8ClampedArray,
  width: number,
  y0: number,
  y1: number,
): number {
  let bestX = Math.floor(width / 2);
  let best = -1;
  const step = Math.max(1, Math.floor(width / 32));
  const ya = Math.max(0, Math.floor(y0));
  const yb = Math.min(heightSafe(y1), Math.ceil(y1));
  for (let x = 0; x < width; x += step) {
    let s = 0;
    let n = 0;
    for (let y = ya; y < yb; y += 2) {
      s += lumaAt(data, width, x, y);
      n += 1;
    }
    const avg = n ? s / n : 0;
    if (avg > best) {
      best = avg;
      bestX = x;
    }
  }
  return bestX / width;

  function heightSafe(y: number): number {
    return Math.max(0, Math.floor(y));
  }
}

function det(
  kind: VenueDetection["kind"],
  label: string,
  nx: number,
  nz: number,
  extras: Partial<VenueDetection> = {},
): VenueDetection {
  const sizes: Record<VenueDetection["kind"], { width: number; depth: number; height: number }> = {
    door: { width: 0.9, depth: 0.12, height: 2.1 },
    screen: { width: 2.4, depth: 0.08, height: 1.5 },
    table: { width: 1.2, depth: 0.6, height: 0.74 },
    chair: { width: 0.45, depth: 0.45, height: 0.9 },
    regTable: { width: 1.5, depth: 0.7, height: 0.74 },
    obstacle: { width: 0.8, depth: 0.8, height: 1 },
    "tile-hint": { width: 0.6, depth: 0.6, height: 0.01 },
  };
  const s = sizes[kind];
  return {
    id: `vis_${kind}_${Math.round(nx * 100)}_${Math.round(nz * 100)}`,
    kind,
    label,
    nx,
    nz,
    width: s.width,
    depth: s.depth,
    height: s.height,
    confidence: extras.confidence ?? 0.7,
    confirmed: extras.confirmed ?? true,
    needsReview: extras.needsReview ?? false,
    serviceRole: extras.serviceRole,
  };
}

/**
 * Deterministic pixel heuristics. Same pixels → same detections, regardless of filename.
 */
export function analyzeVenuePixels(
  width: number,
  height: number,
  data: Uint8ClampedArray,
): VenueDetection[] {
  if (width < 4 || height < 4 || data.length < width * height * 4) return [];

  const top = bandLuma(data, width, height, 0, 0, width, height * 0.15);
  const mid = bandLuma(data, width, height, 0, height * 0.35, width, height * 0.7);
  const bottom = bandLuma(data, width, height, 0, height * 0.82, width, height);
  const left = bandLuma(data, width, height, 0, 0, width * 0.1, height);
  const right = bandLuma(data, width, height, width * 0.9, 0, width, height);

  const out: VenueDetection[] = [];

  if (top > 160) {
    const nx = brightestX(data, width, 0, height * 0.15);
    out.push(det("screen", "投影幕", clamp01(nx), 0.1, { confidence: 0.74 }));
  }

  const edges = [
    { id: "bottom" as const, v: bottom, nx: 0.5, nz: 0.9 },
    { id: "left" as const, v: left, nx: 0.08, nz: 0.55 },
    { id: "right" as const, v: right, nx: 0.92, nz: 0.55 },
  ];
  edges.sort((a, b) => a.v - b.v);
  const door = edges[0];
  if (door.v < mid - 12 || door.v < 90) {
    out.push(det("door", "門", door.nx, door.nz, { confidence: 0.78 }));
  }

  // Mid-room blobs: 3×3 cells darker than the top band but not as dark as a door.
  const cells: { nx: number; nz: number; luma: number }[] = [];
  for (let gy = 0; gy < 3; gy++) {
    for (let gx = 0; gx < 3; gx++) {
      const x0 = width * (0.2 + gx * 0.2);
      const y0 = height * (0.35 + gy * 0.15);
      const x1 = x0 + width * 0.18;
      const y1 = y0 + height * 0.12;
      const luma = bandLuma(data, width, height, x0, y0, x1, y1);
      cells.push({ nx: (0.2 + gx * 0.2 + 0.09), nz: (0.35 + gy * 0.15 + 0.06), luma });
    }
  }
  const tableCells = cells
    .filter((c) => c.luma > 70 && c.luma < 175 && Math.abs(c.luma - mid) < 40)
    .sort((a, b) => a.luma - b.luma)
    .slice(0, 3);
  tableCells.forEach((c, i) => {
    out.push(det(
      i === 0 && c.nz > 0.55 ? "regTable" : "table",
      i === 0 && c.nz > 0.55 ? "報到桌" : "桌子",
      clamp01(c.nx),
      clamp01(c.nz),
      {
        confidence: 0.62,
        needsReview: true,
        confirmed: true,
        serviceRole: i === 0 && c.nz > 0.55 ? "checkin" : undefined,
      },
    ));
  });

  out.push(det("tile-hint", "地磚參考", 0.22, 0.42, {
    confidence: 0.55,
    confirmed: false,
    needsReview: true,
  }));

  return out;
}

function clamp01(n: number): number {
  return Math.max(0.04, Math.min(0.96, n));
}

export async function decodeDataUrl(
  dataUrl: string,
): Promise<{ width: number; height: number; data: Uint8ClampedArray } | null> {
  if (typeof document === "undefined" || typeof Image === "undefined") return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx || canvas.width < 1 || canvas.height < 1) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0);
        const pix = ctx.getImageData(0, 0, canvas.width, canvas.height);
        resolve({ width: pix.width, height: pix.height, data: pix.data });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/** Uses pixels when a photo is present; otherwise the filename mock. */
export class LocalVisionVenueProvider implements VenueProvider {
  readonly id = "local-vision";
  private readonly fallback = new MockVenueProvider();

  async detect(imageName: string, dataUrl: string | null): Promise<VenueDetection[]> {
    if (!dataUrl) return this.fallback.detect(imageName, dataUrl);
    const decoded = await decodeDataUrl(dataUrl);
    if (!decoded) return this.fallback.detect(imageName, dataUrl);
    const found = analyzeVenuePixels(decoded.width, decoded.height, decoded.data);
    return found.length ? found : this.fallback.detect(imageName, dataUrl);
  }
}

export function createDefaultVenueProvider(): VenueProvider {
  return new LocalVisionVenueProvider();
}

/**
 * Mat layout math — array footprint, zone capacity and overflow.
 * All values in meters.
 */

export interface MatArraySpec {
  matWidth: number; // +X
  matDepth: number; // +Z
  rows: number; // count along +Z
  cols: number; // count along +X
  gapX: number; // horizontal gap between columns
  gapZ: number; // vertical gap between rows
}

export interface MatArrayFootprint {
  count: number;
  totalWidth: number; // occupied width (+X)
  totalDepth: number; // occupied depth (+Z)
}

/** Total footprint of an R x C mat array including inter-mat gaps. */
export function matArrayFootprint(spec: MatArraySpec): MatArrayFootprint {
  const cols = Math.max(0, Math.floor(spec.cols));
  const rows = Math.max(0, Math.floor(spec.rows));
  const totalWidth =
    cols <= 0 ? 0 : cols * spec.matWidth + (cols - 1) * spec.gapX;
  const totalDepth =
    rows <= 0 ? 0 : rows * spec.matDepth + (rows - 1) * spec.gapZ;
  return { count: rows * cols, totalWidth, totalDepth };
}

/**
 * Local (unrotated) center offsets of each mat in an array, relative to the
 * array's top-left (min X, min Z) origin. Used for both preview and commit.
 */
export function matArrayOffsets(spec: MatArraySpec): { x: number; z: number }[] {
  const cols = Math.max(0, Math.floor(spec.cols));
  const rows = Math.max(0, Math.floor(spec.rows));
  const out: { x: number; z: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({
        x: c * (spec.matWidth + spec.gapX) + spec.matWidth / 2,
        z: r * (spec.matDepth + spec.gapZ) + spec.matDepth / 2,
      });
    }
  }
  return out;
}

export interface ZoneCapacity {
  maxCols: number;
  maxRows: number;
  capacity: number;
  clearanceX: number; // remaining horizontal space, meters
  clearanceZ: number; // remaining vertical space, meters
  /** Overflow (meters) when the requested layout exceeds the zone; 0 if it fits. */
  overflowX: number;
  overflowZ: number;
  fits: boolean;
}

/**
 * How many mats of the given size + gap fit inside a zone, plus the
 * clearance/overflow relative to a requested rows x cols layout.
 */
export function zoneMatCapacity(
  zoneWidth: number,
  zoneDepth: number,
  spec: MatArraySpec,
): ZoneCapacity {
  const maxCols = capacityAlongAxis(zoneWidth, spec.matWidth, spec.gapX);
  const maxRows = capacityAlongAxis(zoneDepth, spec.matDepth, spec.gapZ);

  const requested = matArrayFootprint(spec);
  const overflowX = Math.max(0, requested.totalWidth - zoneWidth);
  const overflowZ = Math.max(0, requested.totalDepth - zoneDepth);

  return {
    maxCols,
    maxRows,
    capacity: maxCols * maxRows,
    clearanceX: Math.max(0, zoneWidth - requested.totalWidth),
    clearanceZ: Math.max(0, zoneDepth - requested.totalDepth),
    overflowX,
    overflowZ,
    fits: overflowX <= 1e-9 && overflowZ <= 1e-9,
  };
}

export interface MatPreviewState {
  spec: MatArraySpec;
  rotationDeg: number;
  /** World position (meters) of the array's min-corner anchor before rotation. */
  anchorX: number;
  anchorZ: number;
  /** Optional zone the layout is being fitted into, for capacity feedback. */
  zoneId: string | null;
}

/** World-space centers (meters) of every ghost mat in a preview. */
export function matPreviewCenters(
  pre: MatPreviewState,
): { x: number; z: number }[] {
  const offsets = matArrayOffsets(pre.spec);
  const t = (pre.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  return offsets.map((o) => ({
    x: pre.anchorX + o.x * cos - o.z * sin,
    z: pre.anchorZ + o.x * sin + o.z * cos,
  }));
}

function capacityAlongAxis(
  available: number,
  size: number,
  gap: number,
): number {
  if (size <= 0) return 0;
  // n items need n*size + (n-1)*gap <= available.
  const n = Math.floor((available + gap) / (size + gap) + 1e-9);
  return Math.max(0, n);
}

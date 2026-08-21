/**
 * WorkspaceViewport / CanvasSafeRect — pure geometry.
 *
 * The WebGL canvas always spans the whole window (`#scene { inset: 0 }`), but the
 * workspace chrome (header, bottom navigation, docked panels, bottom sheets)
 * floats on top of it. The rectangle the user can *actually* see is therefore
 * smaller than the canvas, and often not centred on it.
 *
 * Everything that frames the world — camera fit, recenter, focusObject,
 * validation focus, simulation focus, pointer clamping — must be expressed
 * against that visible rectangle (the "CanvasSafeRect"), never against the
 * window. This module holds the DOM-free half of that model so the rules are
 * unit-testable; `src/ui/workspaceViewport.ts` measures the live DOM and feeds
 * it here.
 */

export type WorkspaceMode = "phone" | "tablet" | "desktop";

export const WORKSPACE_BREAKPOINTS = {
  /** Phone: canvas-first, bottom nav + bottom sheet. */
  phoneMaxWidth: 600,
  /** Tablet / compact: canvas-first, single-row header, never two docked rails. */
  tabletMaxWidth: 1199,
} as const;

export function workspaceModeForWidth(width: number): WorkspaceMode {
  if (width <= WORKSPACE_BREAKPOINTS.phoneMaxWidth) return "phone";
  if (width <= WORKSPACE_BREAKPOINTS.tabletMaxWidth) return "tablet";
  return "desktop";
}

/** Which chrome may permanently steal canvas width/height in a given mode. */
export interface DockingPolicy {
  /** Left workflow panel is a permanent rail. */
  dockLeft: boolean;
  /** Right inspector is a permanent rail. */
  dockRight: boolean;
  /** Workflow switching lives in a bottom navigation bar. */
  bottomNav: boolean;
  /** Header must fit on exactly one row (overflow goes to the More sheet). */
  singleRowHeader: boolean;
  /** Selecting something opens the full inspector straight away. */
  autoOpenInspector: boolean;
}

export function dockingPolicy(mode: WorkspaceMode): DockingPolicy {
  if (mode === "desktop") {
    return {
      dockLeft: true,
      dockRight: true,
      bottomNav: false,
      singleRowHeader: false,
      autoOpenInspector: true,
    };
  }
  // Phone and tablet share the canvas-first contract: no docked rails at all,
  // so the two of them can never both eat into the canvas at the same time.
  return {
    dockLeft: false,
    dockRight: false,
    bottomNav: true,
    singleRowHeader: true,
    autoOpenInspector: false,
  };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ChromeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Raw measurements of the workspace chrome, in CSS pixels. */
export interface ChromeMetrics {
  /** Height of the (always single-row on compact) header. */
  headerHeight: number;
  /** Height of the bottom navigation, including its safe-area padding. */
  bottomNavHeight: number;
  /** Partner Mode uses the bottom strip even on desktop. */
  partnerDockHeight?: number;
  /** Width of the left workflow rail — only honoured when docked. */
  leftPanelWidth: number;
  /** Width of the right inspector rail — only honoured when docked. */
  rightPanelWidth: number;
  /**
   * Height of an open bottom sheet (workflow panel or inspector), measured up
   * from the bottom of the canvas. A sheet genuinely hides that strip, so it
   * shrinks the visible canvas and the camera re-anchors on what is left.
   */
  bottomSheetHeight: number;
  /**
   * Height of the small transient bars (selection context, placement, measure).
   * They come and go constantly, so they must never move the camera — they only
   * keep focus targets and the placement ghost from hiding behind them.
   */
  bottomBarHeight: number;
}

export const EMPTY_CHROME: ChromeMetrics = {
  headerHeight: 0,
  bottomNavHeight: 0,
  partnerDockHeight: 0,
  leftPanelWidth: 0,
  rightPanelWidth: 0,
  bottomSheetHeight: 0,
  bottomBarHeight: 0,
};

/** Never shrink the usable canvas below this, whatever the chrome claims. */
export const MIN_CANVAS_SIZE = 120;

/**
 * Chrome that is on screen for the whole session in this mode. The rect it
 * leaves is the workspace budget the canvas-first Definition of Done is
 * measured against.
 */
export function persistentInsets(mode: WorkspaceMode, m: ChromeMetrics): ChromeInsets {
  const policy = dockingPolicy(mode);
  return {
    top: Math.max(0, m.headerHeight),
    right: policy.dockRight ? Math.max(0, m.rightPanelWidth) : 0,
    bottom: policy.bottomNav
      ? Math.max(0, m.bottomNavHeight)
      : Math.max(0, m.partnerDockHeight ?? 0),
    left: policy.dockLeft ? Math.max(0, m.leftPanelWidth) : 0,
  };
}

/**
 * Everything the user can genuinely see right now: persistent chrome plus any
 * open bottom sheet. This is the rect the camera anchors on.
 */
export function visibleInsets(mode: WorkspaceMode, m: ChromeMetrics): ChromeInsets {
  const base = persistentInsets(mode, m);
  return { ...base, bottom: base.bottom + Math.max(0, m.bottomSheetHeight) };
}

/** Visible canvas minus the transient bars — where focus targets must land. */
export function focusInsets(mode: WorkspaceMode, m: ChromeMetrics): ChromeInsets {
  const base = visibleInsets(mode, m);
  return { ...base, bottom: base.bottom + Math.max(0, m.bottomBarHeight) };
}

/**
 * Shrink `canvas` by `insets`, keeping at least `min` px in each axis. When the
 * chrome would over-claim, the remaining strip is kept inside the canvas rather
 * than collapsing to zero (which would make NDC maths blow up).
 */
export function insetRect(canvas: Rect, insets: ChromeInsets, min = MIN_CANVAS_SIZE): Rect {
  const minW = Math.min(min, canvas.width);
  const minH = Math.min(min, canvas.height);

  let left = Math.max(0, insets.left);
  let right = Math.max(0, insets.right);
  const overflowX = left + right - (canvas.width - minW);
  if (overflowX > 0) {
    const total = left + right || 1;
    left -= (overflowX * left) / total;
    right -= (overflowX * right) / total;
  }

  let top = Math.max(0, insets.top);
  let bottom = Math.max(0, insets.bottom);
  const overflowY = top + bottom - (canvas.height - minH);
  if (overflowY > 0) {
    const total = top + bottom || 1;
    top -= (overflowY * top) / total;
    bottom -= (overflowY * bottom) / total;
  }

  return {
    x: canvas.x + left,
    y: canvas.y + top,
    width: Math.max(minW, canvas.width - left - right),
    height: Math.max(minH, canvas.height - top - bottom),
  };
}

/**
 * Normalised device coordinates of a rect's centre inside the canvas. This is
 * the anchor camera framing aims at: NDC (0,0) is the canvas centre, which on a
 * compact workspace is *not* the centre of what the user can see.
 */
export function rectCenterNdc(rect: Rect, canvas: Rect): { x: number; y: number } {
  const w = canvas.width || 1;
  const h = canvas.height || 1;
  const cx = rect.x + rect.width / 2 - canvas.x;
  const cy = rect.y + rect.height / 2 - canvas.y;
  return { x: (cx / w) * 2 - 1, y: -((cy / h) * 2 - 1) };
}

/** Share of the canvas area that is genuinely visible workspace (0..1). */
export function rectCoverage(rect: Rect, canvas: Rect): number {
  const area = canvas.width * canvas.height;
  if (area <= 0) return 0;
  return (rect.width * rect.height) / area;
}

/** Clamp a client-space point into `rect`, inset by `pad` px on each side. */
export function clampPointToRect(
  point: { x: number; y: number },
  rect: Rect,
  pad = 0,
): { x: number; y: number } {
  const px = Math.min(pad, Math.max(0, rect.width / 2 - 1));
  const py = Math.min(pad, Math.max(0, rect.height / 2 - 1));
  return {
    x: Math.min(Math.max(point.x, rect.x + px), rect.x + rect.width - px),
    y: Math.min(Math.max(point.y, rect.y + py), rect.y + rect.height - py),
  };
}

export function rectsEqual(a: Rect | null, b: Rect | null, eps = 0.5): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.x - b.x) < eps &&
    Math.abs(a.y - b.y) < eps &&
    Math.abs(a.width - b.width) < eps &&
    Math.abs(a.height - b.height) < eps
  );
}

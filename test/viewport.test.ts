import { describe, expect, it } from "vitest";
import {
  clampPointToRect,
  dockingPolicy,
  insetRect,
  MIN_CANVAS_SIZE,
  focusInsets,
  persistentInsets,
  rectCenterNdc,
  rectCoverage,
  rectsEqual,
  visibleInsets,
  workspaceModeForWidth,
  type ChromeMetrics,
  type Rect,
} from "../src/core/viewport";

const canvasOf = (width: number, height: number): Rect => ({ x: 0, y: 0, width, height });

/** Chrome a real device produces: single-row header + bottom nav, no rails. */
function chrome(over: Partial<ChromeMetrics> = {}): ChromeMetrics {
  return {
    headerHeight: 52,
    bottomNavHeight: 58,
    leftPanelWidth: 300,
    rightPanelWidth: 320,
    bottomSheetHeight: 0,
    bottomBarHeight: 0,
    ...over,
  };
}

describe("workspace breakpoints", () => {
  it("splits phone / tablet / desktop at 600 and 1200", () => {
    expect(workspaceModeForWidth(360)).toBe("phone");
    expect(workspaceModeForWidth(600)).toBe("phone");
    expect(workspaceModeForWidth(601)).toBe("tablet");
    expect(workspaceModeForWidth(1199)).toBe("tablet");
    expect(workspaceModeForWidth(1200)).toBe("desktop");
  });

  it("treats the 820-1199 band as tablet, not desktop", () => {
    // The regression this rewrite exists for: a 900-1100px tablet used to get
    // the full desktop chrome (300px rail + 320px inspector + wrapped header).
    for (const w of [821, 900, 1000, 1100, 1180]) {
      expect(workspaceModeForWidth(w)).toBe("tablet");
    }
  });

  it("never docks two side rails outside desktop", () => {
    for (const mode of ["phone", "tablet"] as const) {
      const policy = dockingPolicy(mode);
      expect(policy.dockLeft).toBe(false);
      expect(policy.dockRight).toBe(false);
      expect(policy.bottomNav).toBe(true);
      expect(policy.singleRowHeader).toBe(true);
      expect(policy.autoOpenInspector).toBe(false);
    }
    const desktop = dockingPolicy("desktop");
    expect(desktop.dockLeft && desktop.dockRight).toBe(true);
    expect(desktop.bottomNav).toBe(false);
  });
});

describe("chrome insets", () => {
  it("ignores rail widths on compact modes", () => {
    for (const mode of ["phone", "tablet"] as const) {
      const insets = persistentInsets(mode, chrome());
      expect(insets.left).toBe(0);
      expect(insets.right).toBe(0);
      expect(insets.top).toBe(52);
      expect(insets.bottom).toBe(58);
    }
  });

  it("honours both rails and drops the nav on desktop", () => {
    const insets = persistentInsets("desktop", chrome());
    expect(insets.left).toBe(300);
    expect(insets.right).toBe(320);
    expect(insets.bottom).toBe(0);
  });

  it("reserves the partner dock on desktop", () => {
    const insets = persistentInsets("desktop", chrome({ partnerDockHeight: 48 }));
    expect(insets.bottom).toBe(48);
  });

  it("layers the workspace budget, the visible rect and the focus rect", () => {
    const m = chrome({ bottomSheetHeight: 300, bottomBarHeight: 60 });
    // The permanent budget is what the canvas-first target is measured against.
    expect(persistentInsets("tablet", m).bottom).toBe(58);
    // An open sheet genuinely hides canvas, so the camera re-anchors on this.
    expect(visibleInsets("tablet", m).bottom).toBe(358);
    // Transient bars only push focus targets, never the camera.
    expect(focusInsets("tablet", m).bottom).toBe(418);
  });
});

describe("CanvasSafeRect", () => {
  it("is the visible strip, not the whole window", () => {
    const canvas = canvasOf(768, 1024);
    const safe = insetRect(canvas, persistentInsets("tablet", chrome()));
    expect(safe).toEqual({ x: 0, y: 52, width: 768, height: 1024 - 52 - 58 });
  });

  it("keeps a usable strip when the chrome over-claims", () => {
    const canvas = canvasOf(400, 200);
    const safe = insetRect(canvas, { top: 150, right: 0, bottom: 150, left: 0 });
    expect(safe.height).toBeGreaterThanOrEqual(Math.min(MIN_CANVAS_SIZE, canvas.height));
    expect(safe.y).toBeGreaterThanOrEqual(canvas.y);
    expect(safe.y + safe.height).toBeLessThanOrEqual(canvas.y + canvas.height + 1e-6);
  });

  it("centres NDC on the visible rect, not the canvas centre", () => {
    const canvas = canvasOf(768, 1024);
    const safe = insetRect(canvas, persistentInsets("tablet", chrome()));
    const ndc = rectCenterNdc(safe, canvas);
    expect(ndc.x).toBeCloseTo(0, 6);
    // Header (52) is smaller than the nav (58), so the visible centre sits
    // slightly *above* the canvas centre — a positive NDC y.
    expect(ndc.y).toBeGreaterThan(0);
    expect(ndc.y).toBeCloseTo(((1024 / 2 - (52 + (1024 - 110) / 2)) / (1024 / 2)), 6);
  });

  it("puts NDC (0,0) at the canvas centre when nothing is covering it", () => {
    const canvas = canvasOf(1366, 1024);
    expect(rectCenterNdc(canvas, canvas)).toEqual({ x: 0, y: -0 });
  });
});

describe("canvas-first acceptance viewports", () => {
  // Definition of Done: opening the workspace on a tablet in portrait must show
  // a canvas, not a settings column. Every acceptance viewport is checked.
  const VIEWPORTS: [number, number][] = [
    [360, 800], [390, 844], [412, 915], [600, 960],
    [768, 1024], [800, 1280], [962, 1280], [1024, 768],
    [1180, 820], [1366, 1024],
  ];

  it("keeps at least 70% of the canvas as workspace on first paint", () => {
    for (const [w, h] of VIEWPORTS) {
      const canvas = canvasOf(w, h);
      const mode = workspaceModeForWidth(w);
      // Desktop shows the left rail from the start; the inspector is contextual.
      const m = chrome({ rightPanelWidth: 0 });
      const safe = insetRect(canvas, persistentInsets(mode, m));
      const coverage = rectCoverage(safe, canvas);
      expect(
        coverage,
        `${mode} ${w}x${h} coverage ${(coverage * 100).toFixed(1)}%`,
      ).toBeGreaterThanOrEqual(0.7);
    }
  });

  it("beats the old desktop-chrome-on-tablet layout in the 768-1180 band", () => {
    for (const [w, h] of VIEWPORTS.filter(([x]) => x >= 768 && x <= 1180)) {
      const canvas = canvasOf(w, h);
      // What the pre-rewrite layout did at these widths: both rails docked and
      // a three-row header.
      const legacy = insetRect(canvas, { top: 150, right: 320, bottom: 0, left: 300 });
      const next = insetRect(canvas, persistentInsets(workspaceModeForWidth(w), chrome({ rightPanelWidth: 0 })));
      expect(rectCoverage(next, canvas)).toBeGreaterThan(rectCoverage(legacy, canvas) * 1.5);
      expect(next.width).toBe(w);
    }
  });
});

describe("pointer clamping", () => {
  it("keeps a lifted touch ghost inside the visible canvas", () => {
    const rect: Rect = { x: 0, y: 52, width: 768, height: 914 };
    expect(clampPointToRect({ x: 400, y: 10 }, rect, 8)).toEqual({ x: 400, y: 60 });
    expect(clampPointToRect({ x: 400, y: 2000 }, rect, 8)).toEqual({ x: 400, y: 958 });
    expect(clampPointToRect({ x: 400, y: 500 }, rect, 8)).toEqual({ x: 400, y: 500 });
  });
});

describe("rect equality", () => {
  it("ignores sub-pixel jitter so measurement loops settle", () => {
    expect(rectsEqual({ x: 0, y: 0, width: 10, height: 10 }, { x: 0.2, y: 0, width: 10, height: 10 })).toBe(true);
    expect(rectsEqual({ x: 0, y: 0, width: 10, height: 10 }, { x: 2, y: 0, width: 10, height: 10 })).toBe(false);
    expect(rectsEqual(null, { x: 0, y: 0, width: 1, height: 1 })).toBe(false);
  });
});

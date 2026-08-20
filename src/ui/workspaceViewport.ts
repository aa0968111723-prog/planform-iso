/**
 * Live WorkspaceViewport: measures the real workspace chrome and publishes the
 * CanvasSafeRect that camera framing, focus and pointer clamping run against.
 *
 * The geometry rules live in `src/core/viewport.ts`; this file only reads the
 * DOM and pushes the result out (to CSS custom properties and to subscribers).
 */

import {
  EMPTY_CHROME,
  focusInsets,
  insetRect,
  persistentInsets,
  rectCoverage,
  rectsEqual,
  visibleInsets,
  workspaceModeForWidth,
  type ChromeMetrics,
  type Rect,
  type WorkspaceMode,
} from "../core/viewport";

export interface WorkspaceChrome {
  /** Top-anchored bars; the tallest visible one is the header inset. */
  header: HTMLElement | HTMLElement[];
  /** Bottom-anchored permanent bars (editor nav, partner dock). */
  nav: HTMLElement | HTMLElement[];
  /** Bottom sheets on compact layouts, docked rails on desktop. */
  left: HTMLElement;
  right: HTMLElement;
  /** Transient bottom bars (selection context, placement, measure). */
  bars: HTMLElement[];
  /** Extra bottom sheets that behave like `left`/`right` (partner sheet). */
  sheets?: HTMLElement[];
}

export interface WorkspaceViewportState {
  mode: WorkspaceMode;
  /** Canvas rect in client coordinates. */
  canvas: Rect;
  /** Canvas minus permanent chrome — the workspace budget (drives `coverage`). */
  baseRect: Rect;
  /** What the user can actually see: `baseRect` minus any open sheet. */
  safeRect: Rect;
  /** `safeRect` minus transient bars — where focus targets must land. */
  focusRect: Rect;
  /** Share of the canvas that is permanently available workspace (0..1). */
  coverage: number;
  metrics: ChromeMetrics;
}

type Listener = (state: WorkspaceViewportState) => void;

function headers(chrome: WorkspaceChrome): HTMLElement[] {
  return Array.isArray(chrome.header) ? chrome.header : [chrome.header];
}

function navs(chrome: WorkspaceChrome): HTMLElement[] {
  return Array.isArray(chrome.nav) ? chrome.nav : [chrome.nav];
}

function visible(node: HTMLElement | null | undefined): boolean {
  if (!node) return false;
  const r = node.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const style = getComputedStyle(node);
  return style.display !== "none" && style.visibility !== "hidden";
}

/** Height of a bottom-anchored overlay measured up from the canvas bottom edge. */
function bottomOverlayHeight(node: HTMLElement, canvas: Rect): number {
  if (!visible(node)) return 0;
  const r = node.getBoundingClientRect();
  // Panels park off-canvas via transforms: below the fold on compact layouts,
  // off to the side when a desktop rail is closed. Neither covers anything.
  if (r.right <= canvas.x || r.left >= canvas.x + canvas.width) return 0;
  const canvasBottom = canvas.y + canvas.height;
  if (r.top >= canvasBottom) return 0;
  return Math.max(0, canvasBottom - r.top);
}

export class WorkspaceViewport {
  private chrome: WorkspaceChrome | null = null;
  private listeners = new Set<Listener>();
  private state: WorkspaceViewportState;
  private frame: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readyFrame: number | null = null;

  constructor(
    private root: HTMLElement,
    private canvas: HTMLElement,
  ) {
    this.state = this.compute();
    this.publish(this.state);
  }

  registerChrome(chrome: WorkspaceChrome): void {
    this.chrome = chrome;
    const nodes = [
      ...headers(chrome), ...navs(chrome), chrome.left, chrome.right,
      ...(chrome.sheets ?? []), ...chrome.bars,
    ];
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver?.disconnect();
      this.resizeObserver = new ResizeObserver(() => this.schedule());
      for (const node of nodes) this.resizeObserver.observe(node);
    }
    // A sheet sliding in or out changes what covers the canvas without changing
    // any element's size, so ResizeObserver never fires — re-measure when the
    // slide finishes (and once mid-flight, so focus targeting keeps up).
    for (const node of nodes) {
      node.addEventListener("transitionend", (e) => {
        if ((e as TransitionEvent).propertyName === "transform") this.schedule();
      });
      node.addEventListener("transitionstart", (e) => {
        if ((e as TransitionEvent).propertyName === "transform") this.schedule();
      });
    }
    this.measure();
  }

  /** Start listening to window / visual-viewport changes. */
  start(): () => void {
    const onResize = () => this.schedule();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("scroll", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("scroll", onResize);
      this.resizeObserver?.disconnect();
    };
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    cb(this.state);
    return () => this.listeners.delete(cb);
  }

  get current(): WorkspaceViewportState {
    return this.state;
  }

  get mode(): WorkspaceMode {
    return this.state.mode;
  }

  /** Coalesce bursts of layout events into one measurement per frame. */
  schedule(): void {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.measure();
    });
  }

  measure(): void {
    const next = this.compute();
    const changed =
      next.mode !== this.state.mode ||
      !rectsEqual(next.canvas, this.state.canvas) ||
      !rectsEqual(next.baseRect, this.state.baseRect) ||
      !rectsEqual(next.safeRect, this.state.safeRect) ||
      !rectsEqual(next.focusRect, this.state.focusRect);
    this.state = next;
    this.publish(next);
    if (changed) for (const cb of this.listeners) cb(next);
  }

  private compute(): WorkspaceViewportState {
    const box = this.canvas.getBoundingClientRect();
    const canvas: Rect = {
      x: box.left,
      y: box.top,
      width: box.width || window.innerWidth,
      height: box.height || window.innerHeight,
    };
    const mode = workspaceModeForWidth(canvas.width);
    const metrics = this.readMetrics(canvas);
    const baseRect = insetRect(canvas, persistentInsets(mode, metrics));
    const safeRect = insetRect(canvas, visibleInsets(mode, metrics));
    const focusRect = insetRect(canvas, focusInsets(mode, metrics));
    return { mode, canvas, baseRect, safeRect, focusRect, coverage: rectCoverage(baseRect, canvas), metrics };
  }

  private readMetrics(canvas: Rect): ChromeMetrics {
    const c = this.chrome;
    if (!c) return { ...EMPTY_CHROME };
    // Team view swaps the editing header for its own bar; take whichever is up.
    const header = Math.max(0, ...headers(c).map((n) => (visible(n) ? n.getBoundingClientRect().height : 0)));
    // Editor bottom nav and partner dock are mutually exclusive; take whichever is up.
    const nav = Math.max(0, ...navs(c).map((n) => (visible(n) ? n.getBoundingClientRect().height : 0)));
    // Rail widths only count when the panel is genuinely docked beside the
    // canvas; in sheet mode it is a bottom overlay instead.
    const docked = (node: HTMLElement) =>
      visible(node) && getComputedStyle(node).getPropertyValue("--ws-docked").trim() === "1";
    const left = docked(c.left) ? c.left.getBoundingClientRect().width : 0;
    const right = docked(c.right) ? c.right.getBoundingClientRect().width : 0;

    // A panel counts as a bottom sheet only when it is not docked as a rail.
    let sheet = 0;
    if (left === 0) sheet = Math.max(sheet, bottomOverlayHeight(c.left, canvas));
    if (right === 0) sheet = Math.max(sheet, bottomOverlayHeight(c.right, canvas));
    for (const node of c.sheets ?? []) sheet = Math.max(sheet, bottomOverlayHeight(node, canvas));
    let bar = 0;
    for (const node of c.bars) bar = Math.max(bar, bottomOverlayHeight(node, canvas));

    // The nav is already persistent chrome; don't double-count it.
    sheet = Math.max(0, sheet - nav);
    bar = Math.max(0, bar - nav - sheet);

    return {
      headerHeight: header,
      bottomNavHeight: nav,
      leftPanelWidth: left,
      rightPanelWidth: right,
      bottomSheetHeight: sheet,
      bottomBarHeight: bar,
    };
  }

  /**
   * Expose the measured chrome to CSS so sheets, bars and safe-area padding
   * position themselves against real numbers instead of hard-coded guesses.
   */
  private publish(s: WorkspaceViewportState): void {
    const style = this.root.style;
    style.setProperty("--ws-header-h", `${Math.round(s.metrics.headerHeight)}px`);
    style.setProperty("--ws-nav-h", `${Math.round(s.metrics.bottomNavHeight)}px`);
    style.setProperty("--ws-safe-x", `${Math.round(s.safeRect.x - s.canvas.x)}px`);
    style.setProperty("--ws-safe-y", `${Math.round(s.safeRect.y - s.canvas.y)}px`);
    style.setProperty("--ws-safe-w", `${Math.round(s.safeRect.width)}px`);
    style.setProperty("--ws-safe-h", `${Math.round(s.safeRect.height)}px`);
    if (this.root.dataset.wsMode !== s.mode) this.root.dataset.wsMode = s.mode;
    this.markReady();
  }

  /**
   * Panels slide with a CSS transition. On the very first paint the mode
   * attribute lands *after* the elements exist, so without this gate every
   * sheet visibly animates off screen — and the camera would fit itself to the
   * half-covered canvas of that first frame. Transitions stay off until the
   * layout has settled for two frames.
   */
  private markReady(): void {
    if (this.readyFrame !== null || this.root.dataset.wsReady === "1") return;
    this.readyFrame = requestAnimationFrame(() => {
      this.readyFrame = requestAnimationFrame(() => {
        this.readyFrame = null;
        this.root.dataset.wsReady = "1";
        this.measure();
      });
    });
  }
}

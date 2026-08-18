/**
 * Dev-only local diagnostics — never shown in production UI.
 * Enable with localStorage planform-iso:diagnostics=1 or ?diag=1.
 */

export interface DiagnosticsSnapshot {
  renderer?: {
    drawCalls?: number;
    triangles?: number;
    geometries?: number;
    textures?: number;
  };
  simulationMs?: number;
  optimizationCandidates?: number;
  optimizationMs?: number;
  assetLoadFailures: string[];
  agentToolTrace: { tool: string; ok: boolean; ms: number; error?: string }[];
  lastRollbackReason?: string;
}

const KEY = "planform-iso:diagnostics";

let enabled = false;
const snap: DiagnosticsSnapshot = {
  assetLoadFailures: [],
  agentToolTrace: [],
};

export function isDiagnosticsEnabled(): boolean {
  if (enabled) return true;
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "1") {
      enabled = true;
    }
  } catch {
    /* ignore */
  }
  try {
    if (typeof location !== "undefined" && /[?&]diag=1\b/.test(location.search)) {
      enabled = true;
    }
  } catch {
    /* ignore */
  }
  return enabled;
}

export function enableDiagnostics(on = true): void {
  enabled = on;
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function getDiagnostics(): DiagnosticsSnapshot {
  return snap;
}

export function recordAssetLoadFailure(msg: string): void {
  if (!isDiagnosticsEnabled()) return;
  snap.assetLoadFailures.push(msg);
  if (snap.assetLoadFailures.length > 40) snap.assetLoadFailures.shift();
}

export function recordSimulationTiming(ms: number): void {
  if (!isDiagnosticsEnabled()) return;
  snap.simulationMs = ms;
}

export function recordOptimization(candidates: number, ms: number): void {
  if (!isDiagnosticsEnabled()) return;
  snap.optimizationCandidates = candidates;
  snap.optimizationMs = ms;
}

export function recordAgentTool(tool: string, ok: boolean, ms: number, error?: string): void {
  if (!isDiagnosticsEnabled()) return;
  snap.agentToolTrace.push({ tool, ok, ms, error });
  if (snap.agentToolTrace.length > 80) snap.agentToolTrace.shift();
}

export function recordRollbackReason(reason: string): void {
  if (!isDiagnosticsEnabled()) return;
  snap.lastRollbackReason = reason;
}

export function recordRendererStats(stats: DiagnosticsSnapshot["renderer"]): void {
  if (!isDiagnosticsEnabled()) return;
  snap.renderer = stats;
}

/** Tiny overlay for Advanced/Developer — call from UI when enabled. */
export function formatDiagnosticsText(): string {
  const d = snap;
  const lines: string[] = ["[diagnostics]"];
  if (d.simulationMs != null) lines.push(`sim ${d.simulationMs.toFixed(1)}ms`);
  if (d.optimizationMs != null) {
    lines.push(`opt ${d.optimizationMs.toFixed(1)}ms · ${d.optimizationCandidates ?? 0} candidates`);
  }
  if (d.renderer) {
    lines.push(
      `draw ${d.renderer.drawCalls ?? "—"} · tri ${d.renderer.triangles ?? "—"} · tex ${d.renderer.textures ?? "—"}`,
    );
  }
  if (d.assetLoadFailures.length) {
    lines.push(`asset fails: ${d.assetLoadFailures.slice(-3).join(" | ")}`);
  }
  if (d.lastRollbackReason) lines.push(`rollback: ${d.lastRollbackReason}`);
  const lastTools = d.agentToolTrace.slice(-5);
  for (const t of lastTools) {
    lines.push(`tool ${t.tool} ${t.ok ? "ok" : "fail"} ${t.ms.toFixed(0)}ms${t.error ? ` ${t.error}` : ""}`);
  }
  return lines.join("\n");
}

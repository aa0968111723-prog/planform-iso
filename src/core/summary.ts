import { assetDef } from "./assets";
import type { Project } from "./model";
import { groupFootprint } from "./arrays";

/** Plain-language site summary lines for the inspector / exports. */
export function buildSummaryLines(p: Project): string[] {
  const lines: string[] = [];
  lines.push(`教室：${fmt(p.classroom.length)} × ${fmt(p.classroom.width)} m`);
  lines.push(`走廊：${fmt(p.corridor.length)} × ${fmt(p.corridor.width)} m`);
  lines.push(`地磚：${Math.round(p.tile.width * 100)} × ${Math.round(p.tile.depth * 100)} cm`);

  const counts = new Map<string, number>();
  for (const o of p.objects) counts.set(o.kind, (counts.get(o.kind) ?? 0) + 1);
  for (const g of p.groups) counts.set(g.sourceKind, (counts.get(g.sourceKind) ?? 0) + groupFootprint(g).count);
  const parts = [...counts.entries()].map(([k, n]) => `${assetDef(k as never).displayName}×${n}`);
  if (parts.length) lines.push(`物件：${parts.join("、")}`);
  if (p.zones.length) lines.push(`小區域（${p.zones.length}）：${p.zones.map((z) => z.name).join("、")}`);
  if (p.routes.length) lines.push(`動線（${p.routes.length}）：${p.routes.map((r) => r.name).join("、")}`);
  return lines;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

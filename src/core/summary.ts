import { OBJECT_DEFAULTS, ZONE_DEFAULTS, type Project } from "./model";
import { metersToCm } from "./units";

/**
 * A plain-language summary of a plan, written for staff who do not read 3D
 * diagrams. Returns short human-readable lines plus structured counts.
 */
export interface PlanSummary {
  title: string;
  lines: string[];
  objectCounts: { label: string; count: number }[];
  zoneNames: string[];
  routeNames: string[];
}

export function buildSummary(project: Project): PlanSummary {
  const { classroom, corridor, tile } = project;

  const objectCounts = countObjects(project);
  const zoneNames = project.zones.map((z) => z.name);
  const routeNames = project.routes.map((r) => r.name);

  const lines: string[] = [];
  lines.push(
    `教室：${fmt(classroom.length)} × ${fmt(classroom.width)} 公尺（${area(classroom.length, classroom.width)} 平方公尺）`,
  );
  lines.push(
    `走廊：${fmt(corridor.length)} × ${fmt(corridor.width)} 公尺`,
  );
  lines.push(`地磚：${Math.round(metersToCm(tile.width))} × ${Math.round(metersToCm(tile.depth))} 公分`);

  const matEntry = objectCounts.find((o) => o.label === OBJECT_DEFAULTS.mat.label);
  if (matEntry) lines.push(`地墊：共 ${matEntry.count} 張`);

  if (zoneNames.length) lines.push(`小區域（${zoneNames.length}）：${zoneNames.join("、")}`);

  const nonMat = objectCounts.filter((o) => o.label !== OBJECT_DEFAULTS.mat.label);
  if (nonMat.length) {
    lines.push(`物件：${nonMat.map((o) => `${o.label}×${o.count}`).join("、")}`);
  }

  if (routeNames.length) lines.push(`動線（${routeNames.length}）：${routeNames.join("、")}`);

  return {
    title: project.name || "未命名平面圖",
    lines,
    objectCounts,
    zoneNames,
    routeNames,
  };
}

function countObjects(project: Project): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const o of project.objects) {
    const label = OBJECT_DEFAULTS[o.kind].label;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count }));
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function area(l: number, w: number): string {
  return (l * w).toFixed(1);
}

/** Legend entries so non-experts can decode the colored shapes. */
export function legendEntries(): { color: string; label: string; kind: "zone" | "object" }[] {
  const zones = Object.values(ZONE_DEFAULTS).map((z) => ({
    color: z.color,
    label: z.label,
    kind: "zone" as const,
  }));
  const objects = Object.values(OBJECT_DEFAULTS).map((o) => ({
    color: o.color,
    label: o.label,
    kind: "object" as const,
  }));
  return [...zones, ...objects];
}

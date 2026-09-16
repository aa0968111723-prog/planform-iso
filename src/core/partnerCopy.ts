/**
 * Partner-readable 場刊 copy. No xyz, IDs, mesh or engineering language.
 *
 * These sentences are the same ones a volunteer hears on the first walk-through
 * of a Tamkang classroom layout.
 */

import type { Project, SceneObject, Zone } from "./model";
import { ZONE_DEFAULTS } from "./model";

export const PARTNER_COPY_EXAMPLES = [
  "你現在在教室後側入口",
  "進入後先到左側報到區",
  "鞋子放在地墊兩側",
  "背包放到右側背包區",
  "完成後前往中央青綠色地墊區",
] as const;

function doorSide(project: Project, door: SceneObject | undefined): "後側" | "前側" | "左側" | "右側" | "入口" {
  if (!door) return "入口";
  const c = project.classroom;
  const nx = (door.x - c.x) / Math.max(0.01, c.length);
  const nz = (door.z - c.z) / Math.max(0.01, c.width);
  if (nz > 0.7) return "後側";
  if (nz < 0.3) return "前側";
  if (nx < 0.35) return "左側";
  if (nx > 0.65) return "右側";
  return "後側";
}

function zoneSide(project: Project, zone: Zone | undefined): "左側" | "右側" | "前方" | "後方" | "中央" {
  if (!zone) return "中央";
  const c = project.classroom;
  const nx = (zone.x - c.x) / Math.max(0.01, c.length);
  const nz = (zone.z - c.z) / Math.max(0.01, c.width);
  if (nz < 0.3) return "前方";
  if (nz > 0.7) return "後方";
  if (nx < 0.35) return "左側";
  if (nx > 0.65) return "右側";
  return "中央";
}

function zoneNamed(project: Project, type: Zone["type"]): Zone | undefined {
  return project.zones.find((z) => z.type === type && z.hidden !== true && z.partnerVisible !== false);
}

/**
 * Short partner sentences derived from the live plan. Falls back to the
 * canonical examples when the matching zone has not been placed yet.
 */
export function buildPartnerLayoutCopy(project: Project): string[] {
  const door = project.objects.find((o) => o.kind === "door" && !o.hidden);
  const checkin = zoneNamed(project, "registration");
  const shoes = project.zones.filter((z) => z.type === "shoe" && z.partnerVisible !== false);
  const bags = zoneNamed(project, "backpack");
  const mats = zoneNamed(project, "mats") ?? zoneNamed(project, "meditation") ?? zoneNamed(project, "group");

  const lines: string[] = [];
  lines.push(`你現在在教室${doorSide(project, door)}入口`);

  if (checkin) lines.push(`進入後先到${zoneSide(project, checkin)}報到區`);
  else lines.push(PARTNER_COPY_EXAMPLES[1]);

  if (shoes.length >= 2) lines.push("鞋子放在地墊兩側");
  else if (shoes.length === 1) lines.push(`鞋子放在${zoneSide(project, shoes[0])}鞋子區`);
  else lines.push(PARTNER_COPY_EXAMPLES[2]);

  if (bags) lines.push(`背包放到${zoneSide(project, bags)}背包區`);
  else lines.push(PARTNER_COPY_EXAMPLES[3]);

  if (mats) {
    const name = mats.type === "mats" ? "青綠色地墊區" : (ZONE_DEFAULTS[mats.type]?.label ?? mats.name);
    lines.push(`完成後前往${zoneSide(project, mats)}${name}`);
  } else {
    lines.push(PARTNER_COPY_EXAMPLES[4]);
  }
  return lines.slice(0, 5);
}

/** True when a string looks like engineering leakage a partner must never see. */
export function partnerCopyIsSafe(text: string): boolean {
  if (/\b(x|z|y)\s*[:=]/i.test(text)) return false;
  if (/\b(id|mesh|shader|debug|ndc|gl_)\b/i.test(text)) return false;
  if (/\d+\.\d{3,}/.test(text) && /m\b/.test(text)) return false;
  return true;
}

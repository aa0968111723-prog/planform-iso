/**
 * 我的互動模板 — flows the organiser saved to reuse next time.
 *
 * Same shape as `projectRepository.ts`, deliberately: a versioned index, one
 * key per body, defensive parsing, and a memory fallback when storage is
 * unavailable (private mode, blocked site data) so the app still runs instead
 * of throwing on a click.
 *
 *   planform-iso:interaction-templates        → { version, entries: TemplateMeta[] }
 *   planform-iso:interaction-template:<id>    → InteractionTemplate
 *
 * Saving DROPS station coordinates and every zone/object binding, keeping only
 * the station NAMES. A template is "how the activity runs", not "where the
 * table was in that other room" — carrying coordinates across venues would
 * scatter a booth's stations over somebody else's classroom. Applying matches
 * by name against the plan's own stations and reports what it could not place.
 */

import { migrateInteraction } from "../core/migrate";
import { uid, type InteractionStation, type InteractionTemplate } from "../core/model";

const INDEX_KEY = "planform-iso:interaction-templates";
const BODY_PREFIX = "planform-iso:interaction-template:";
const INDEX_VERSION = 1;

export interface TemplateMeta {
  id: string;
  name: string;
  savedAt: number;
  stepCount: number;
}

interface TemplateIndex {
  version: number;
  entries: TemplateMeta[];
}

/** Used when localStorage is missing or refuses to write. */
const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") return memory.get(key) ?? null;
    return localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string): void {
  memory.set(key, value);
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
  } catch {
    // Full or blocked. The in-memory copy keeps this session working.
  }
}

function drop(key: string): void {
  memory.delete(key);
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(key);
  } catch {
    // Nothing to do; the memory copy is already gone.
  }
}

function readIndex(): TemplateIndex {
  const raw = read(INDEX_KEY);
  if (!raw) return { version: INDEX_VERSION, entries: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<TemplateIndex>;
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    return {
      version: INDEX_VERSION,
      entries: entries.filter((e): e is TemplateMeta =>
        !!e && typeof e.id === "string" && typeof e.name === "string"),
    };
  } catch {
    // A corrupt index must not take the saved bodies with it, and must not
    // stop the panel from rendering.
    return { version: INDEX_VERSION, entries: [] };
  }
}

function writeIndex(index: TemplateIndex): void {
  write(INDEX_KEY, JSON.stringify(index));
}

export function listTemplates(): TemplateMeta[] {
  return [...readIndex().entries].sort((a, b) => b.savedAt - a.savedAt);
}

/**
 * Strip the plan-specific parts.
 *
 * Names stay because they are how a template finds its way back onto a plan;
 * x/z, `objectId`, `zoneId` and the compiled `spatial` block go because they
 * describe one particular room.
 */
export function portableTemplate(template: InteractionTemplate, name: string): InteractionTemplate {
  const stations: InteractionStation[] = template.stations.map((st) => {
    const copy: InteractionStation = { ...st, x: 0, z: 0 };
    delete copy.objectId;
    delete copy.zoneId;
    return copy;
  });
  const portable: InteractionTemplate = {
    ...template,
    id: uid("tpl"),
    name,
    stations,
    steps: template.steps.map((step) => ({ ...step })),
    staff: template.staff.map((role) => ({ ...role })),
    segments: template.segments.map((seg) => ({ ...seg })),
    audience: { ...template.audience },
    settings: { ...template.settings },
  };
  delete portable.spatial;
  return portable;
}

export function saveTemplate(template: InteractionTemplate, name: string): TemplateMeta {
  const trimmed = name.trim() || template.name || "我的互動";
  const body = portableTemplate(template, trimmed);
  const meta: TemplateMeta = {
    id: body.id,
    name: trimmed,
    savedAt: nowMs(),
    stepCount: body.steps.length,
  };
  write(`${BODY_PREFIX}${body.id}`, JSON.stringify(body));
  const index = readIndex();
  writeIndex({ version: INDEX_VERSION, entries: [meta, ...index.entries.filter((e) => e.id !== meta.id)] });
  return meta;
}

export function deleteTemplate(id: string): void {
  drop(`${BODY_PREFIX}${id}`);
  const index = readIndex();
  writeIndex({ version: INDEX_VERSION, entries: index.entries.filter((e) => e.id !== id) });
}

export interface AppliedTemplate {
  template: InteractionTemplate;
  /** Stations that found no station of the same name and were left unplaced. */
  unplaced: string[];
}

/**
 * Put a saved template back on a plan.
 *
 * Stations are matched to the plan's existing ones BY NAME. A match keeps the
 * plan's real position and bindings; a miss lands in the middle of the room and
 * is reported, because a station silently sitting at (0,0) — outside the room,
 * under the wall — would quietly make every distance in the run wrong.
 */
export function applyTemplate(
  saved: InteractionTemplate,
  onto: { stations: InteractionStation[]; centre: { x: number; z: number } },
): AppliedTemplate {
  const byName = new Map(onto.stations.map((st) => [st.name.trim(), st]));
  const unplaced: string[] = [];
  const stations = saved.stations.map((st) => {
    const match = byName.get(st.name.trim());
    if (!match) {
      unplaced.push(st.name);
      return { ...st, x: onto.centre.x, z: onto.centre.z };
    }
    return {
      ...st,
      x: match.x,
      z: match.z,
      ...(match.objectId ? { objectId: match.objectId } : {}),
      ...(match.zoneId ? { zoneId: match.zoneId } : {}),
    };
  });
  return { template: { ...saved, stations }, unplaced };
}

export function loadTemplate(id: string): InteractionTemplate | null {
  const raw = read(`${BODY_PREFIX}${id}`);
  if (!raw) return null;
  try {
    // Through the same defensive migration a project body gets: a template
    // saved by a build that knew one more kind of fork must still open.
    return migrateInteraction(JSON.parse(raw) as Partial<InteractionTemplate>) ?? null;
  } catch {
    return null;
  }
}

function nowMs(): number {
  return Date.now();
}

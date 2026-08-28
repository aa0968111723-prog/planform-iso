/**
 * `.planform-prop.json` — one prop, out of one plan and into another.
 *
 * A definition is already portable: its parts are prop-local geometry, its
 * anchors are prop-local positions, and its interaction fragment is a seed
 * that gets re-instantiated against whatever object it lands on. Nothing in it
 * names a venue, a coordinate, or another prop. So the file is the definition
 * plus an envelope that says what it is.
 *
 * The envelope exists for one reason: to tell a person what went wrong. Handed
 * a project JSON, a truncated download or a file from a future build, this has
 * to answer 「這不是道具檔」 rather than throw, or silently produce a prop with
 * no parts. Every rejection path returns a sentence the UI can show.
 *
 * Import goes through `migrateProps` — the same defensive funnel a project body
 * gets — so a definition saved by a build that knew one more part shape opens
 * here with that part dropped, not with the whole prop refused.
 */

import { migrateProps } from "../core/migrate";
import type { PropDefinition } from "../core/model";

export const PROP_FILE_FORMAT = "planform-prop";
/** Bumped only when the ENVELOPE changes; the definition has its own version. */
export const PROP_FILE_VERSION = 1;

export interface PropFileEnvelope {
  format: typeof PROP_FILE_FORMAT;
  formatVersion: number;
  /** Informational: which app wrote it, for a bug report. */
  app?: string;
  exportedAt?: string;
  prop: PropDefinition;
}

export type PropImportResult =
  | { ok: true; prop: PropDefinition; warnings: string[] }
  | { ok: false; reason: string };

/** The filename a person will recognise six months later. */
export function propFileName(def: Pick<PropDefinition, "name">): string {
  const safe = (def.name || "prop").replace(/[^\w一-龥-]+/g, "_");
  return `${safe}.planform-prop.json`;
}

export function serializeProp(def: PropDefinition, opts: { app?: string; now?: string } = {}): string {
  const envelope: PropFileEnvelope = {
    format: PROP_FILE_FORMAT,
    formatVersion: PROP_FILE_VERSION,
    ...(opts.app ? { app: opts.app } : {}),
    ...(opts.now ? { exportedAt: opts.now } : {}),
    prop: def,
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * Parse a `.planform-prop.json`. Never throws: every failure is a sentence.
 *
 * A newer `formatVersion` is a WARNING, not a rejection — the envelope is a
 * wrapper, and the definition inside still goes through the defensive funnel.
 * Refusing here would strand a prop for no reason.
 */
export function parsePropFile(text: string): PropImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "這個檔案不是有效的 JSON,可能下載到一半或被改壞了。" };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "這個檔案的內容不是一個道具。" };
  }
  const envelope = raw as Partial<PropFileEnvelope> & Record<string, unknown>;

  if (envelope.format !== PROP_FILE_FORMAT) {
    // The most likely mistake by far, and worth naming precisely.
    if (Array.isArray(envelope.objects) || envelope.tile || envelope.classroom) {
      return { ok: false, reason: "這是一份「專案」檔,不是單一道具。請用「匯入 JSON」開啟整個專案。" };
    }
    return { ok: false, reason: "這不是 Planform 道具檔（.planform-prop.json）。" };
  }

  const warnings: string[] = [];
  const version = typeof envelope.formatVersion === "number" ? envelope.formatVersion : 0;
  if (version > PROP_FILE_VERSION) {
    warnings.push("這個道具是比較新的版本存的,有些設定可能讀不進來。");
  }

  const defs = migrateProps([envelope.prop]);
  const prop = defs?.[0];
  if (!prop) {
    return { ok: false, reason: "道具內容讀不出來,這個檔案可能已經損毀。" };
  }
  if (!prop.parts.length) {
    return { ok: false, reason: "這個道具沒有任何零件,沒辦法顯示。" };
  }
  return { ok: true, prop, warnings };
}

/**
 * Give an imported definition an id that cannot collide with what the project
 * already has, keeping the original when it is free.
 *
 * Importing the same prop twice must produce two props, not silently overwrite
 * the first — the second copy may be the one that was edited elsewhere, and
 * clobbering it would destroy work with no undo affordance in the file dialog.
 */
export function claimPropId(prop: PropDefinition, taken: ReadonlySet<string>): PropDefinition {
  if (!taken.has(prop.id)) return prop;
  let n = 2;
  while (taken.has(`${prop.id}_${n}`)) n += 1;
  return { ...prop, id: `${prop.id}_${n}`, name: `${prop.name}（匯入 ${n}）` };
}

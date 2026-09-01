/**
 * Fresh drafts for the Prop Studio, and the rule that decides what counts as
 * 「我做的」in the library.
 *
 * The Studio used to open on a 60 cm interactive cube every time. That is
 * still the right seed for a dice; it is the wrong seed for a nameplate.
 * Two named starters keep those paths from sharing a default that fits
 * neither. They live in core so a test can assert the tabletop mapping
 * without opening a DOM overlay.
 */

import type { PropDefinition } from "./model";
import { uid } from "./model";
import { allPropPresets } from "./propPresets";

export type PropDraftKind = "interactive" | "tabletop" | "badge";

export const PROP_STUDIO_CATEGORIES = ["擺攤小物", "文宣", "互動", "背景"] as const;

/** A 60 cm cube — the seed for a game you have not designed yet. */
export function blankPropDraft(kind: PropDraftKind = "interactive"): PropDefinition {
  if (kind === "badge") {
    // A pin needs a circular *top* face, not a generic rectangular photo
    // panel. `propVisual` paints the artwork on the cylinder's top cap, so a
    // photo uploaded in Prop Studio becomes a true on-desk badge mock-up.
    // Keep it tabletop by default: this is a merch/display item, and it must
    // inherit a table parent rather than silently land on the classroom floor.
    return {
      id: `prop_${uid("p")}`,
      name: "我的胸針",
      category: "擺攤小物",
      placement: "tabletop",
      dimensions: { width: 0.058, depth: 0.058, height: 0.008 },
      parts: [{
        id: "badge-face", shape: "cylinder",
        size: { width: 0.058, depth: 0.058, height: 0.008 },
        offset: { x: 0, y: 0, z: 0 },
        color: "#f8fafc", finish: "plastic-gloss", text: "圖案",
      }, {
        id: "badge-rim", shape: "cylinder",
        size: { width: 0.06, depth: 0.06, height: 0.003 },
        offset: { x: 0, y: 0, z: 0 },
        color: "#94a3b8", finish: "brushed-metal",
      }],
      anchors: [],
      version: 1,
      source: "user",
      icon: "●",
    };
  }
  if (kind === "tabletop") {
    return {
      id: `prop_${uid("p")}`,
      name: "我的小物",
      category: "擺攤小物",
      placement: "tabletop",
      dimensions: { width: 0.2, depth: 0.15, height: 0.1 },
      parts: [{
        id: "part1", shape: "box",
        size: { width: 0.2, depth: 0.15, height: 0.1 },
        offset: { x: 0, y: 0, z: 0 },
        color: "#cbd5e1", finish: "plastic-matte",
      }],
      anchors: [],
      version: 1,
      source: "user",
      icon: "✦",
    };
  }
  return {
    id: `prop_${uid("p")}`,
    name: "我的道具",
    category: "互動",
    dimensions: { width: 0.6, depth: 0.6, height: 0.6 },
    parts: [{
      id: "part1", shape: "box",
      size: { width: 0.6, depth: 0.6, height: 0.6 },
      offset: { x: 0, y: 0, z: 0 },
      color: "#8fb4c9", finish: "plastic-matte",
    }],
    anchors: [],
    version: 1,
    source: "user",
  };
}

/**
 * A definition the person made, not a kit item they picked off the shelf.
 *
 * Placing a QR 立架 copies the preset into the project; that copy must not
 * show up under 我做的. Starting from a preset in the Studio overwrites
 * `source` to `"user"` and mints a new id, which is the custom path.
 */
export function isUserMadeProp(def: Pick<PropDefinition, "id" | "source">): boolean {
  if (def.source === "user" || def.source === "import" || def.source === "agent") return true;
  return !allPropPresets().some((p) => p.id === def.id);
}

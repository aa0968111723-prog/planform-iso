/**
 * Pure prop-editing operations. The Studio's buttons call these; they live in
 * core because "group these objects into one prop" is a statement about data,
 * and a rule in a click handler is a rule nobody can test.
 */

import { uid } from "./model";
import type { AssetCatalogEntry } from "./catalog";
import type {
  PropAnchor,
  PropDefinition,
  PropPart,
  SceneObject,
} from "./model";
import { propForAssetId } from "./propCatalog";

/**
 * §71 「只改這一個」 — fork a definition for one placed instance.
 *
 * A new id, a bumped-from-one version, a marked name; the caller repoints that
 * ONE SceneObject's assetId and regenerates entries. Everything else keeps
 * pointing at the original — editing the fork can never ripple into the other
 * placed copies, which is the entire point.
 */
export function forkDefinition(def: PropDefinition): PropDefinition {
  return {
    ...JSON.parse(JSON.stringify(def)) as PropDefinition,
    id: `prop_${uid("fork")}`,
    name: `${def.name}（獨立版）`,
    version: 1,
    source: "user",
  };
}

export interface AbsorbInput {
  objects: SceneObject[];
  props: PropDefinition[] | undefined;
  /** entry lookup for plain (non-prop) assets: colour and name. */
  entryFor: (o: SceneObject) => Pick<AssetCatalogEntry, "color" | "name"> | undefined;
}

export interface AbsorbResult {
  def: PropDefinition;
  /** Names of interactive props whose interaction was NOT carried (only the first is). */
  droppedInteractions: string[];
}

/**
 * §93 「從選取的物件建立組合道具」 — placed things become one definition.
 *
 * Geometry: every object's centre is re-expressed relative to the selection's
 * centre; a prop contributes its PARTS (shifted), a plain asset contributes
 * one box in its own colour and size. Anchors and the interaction come from
 * the FIRST interactive prop, anchor offsets shifted the same way — so the
 * dice's player spot is still in front of the dice, wherever the dice sits in
 * the new assembly. A second interactive prop's interaction is dropped and
 * NAMED in the result; silently merging two games into one station would
 * change both games' numbers without anyone deciding that.
 */
/**
 * Prop-local (x, z) -> assembly-local, for a source placed at `dx, dz` and
 * turned `rotationDeg`. Same rotation convention as `resolveStationPosition`.
 */
function localToAssembly(rotationDeg: number, dx: number, dz: number) {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return (x: number, z: number) => ({
    x: dx + x * cos + z * sin,
    z: dz - x * sin + z * cos,
  });
}

export function absorbSelection(input: AbsorbInput, name = "組合道具"): AbsorbResult | null {
  const objects = input.objects.filter((o) => !o.hidden);
  if (!objects.length) return null;

  const cx = objects.reduce((s, o) => s + o.x, 0) / objects.length;
  const cz = objects.reduce((s, o) => s + o.z, 0) / objects.length;

  const parts: PropPart[] = [];
  let anchors: PropAnchor[] = [];
  let interaction: PropDefinition["interaction"];
  let interactionSource: PropDefinition | undefined;
  const droppedInteractions: string[] = [];

  for (const obj of objects) {
    const def = propForAssetId(input.props, obj.assetId);
    const dx = obj.x - cx;
    const dz = obj.z - cz;
    if (def) {
      // A part's offset is expressed in the SOURCE prop's local frame, which
      // the placed object rotates in the world. Translating without rotating
      // put a spinner's pointer and a station's sign on the wrong side of a
      // prop the moment it had been turned — and the player anchor with them,
      // so the §85 sentence a volunteer reads pointed at the prop's back.
      // Same convention as resolveStationPosition and propValidationIssues.
      const spin = localToAssembly(obj.rotationDeg, dx, dz);
      for (const part of def.parts) {
        const copy = JSON.parse(JSON.stringify(part)) as PropPart;
        const at = spin(part.offset.x, part.offset.z);
        parts.push({
          ...copy,
          id: `${obj.id}_${part.id}`,
          offset: { x: at.x, y: part.offset.y, z: at.z },
          ...(obj.rotationDeg ? { rotationDeg: (part.rotationDeg ?? 0) + obj.rotationDeg } : {}),
        });
      }
      const carry = (list: typeof def.anchors) =>
        list.map((a) => ({ ...a, ...spin(a.x, a.z),
          ...(a.facingDeg !== undefined ? { facingDeg: a.facingDeg + obj.rotationDeg } : {}) }));
      if (def.interaction) {
        if (!interaction) {
          interaction = JSON.parse(JSON.stringify(def.interaction)) as PropDefinition["interaction"];
          interactionSource = def;
          anchors = carry(def.anchors);
        } else {
          droppedInteractions.push(def.name);
        }
      } else if (!anchors.length && def.anchors.length) {
        anchors = carry(def.anchors);
      }
    } else {
      const entry = input.entryFor(obj);
      parts.push({
        id: `${obj.id}_box`,
        shape: "box",
        size: { width: obj.width, depth: obj.depth, height: obj.height },
        offset: { x: dx, y: obj.elevation ?? 0, z: dz },
        ...(obj.rotationDeg ? { rotationDeg: obj.rotationDeg } : {}),
        color: entry?.color ?? "#c8b6a6",
      });
    }
  }

  const minX = Math.min(...objects.map((o) => o.x - o.width / 2));
  const maxX = Math.max(...objects.map((o) => o.x + o.width / 2));
  const minZ = Math.min(...objects.map((o) => o.z - o.depth / 2));
  const maxZ = Math.max(...objects.map((o) => o.z + o.depth / 2));
  const height = Math.max(...objects.map((o) => (o.elevation ?? 0) + o.height));

  const def: PropDefinition = {
    id: `prop_${uid("asm")}`,
    name,
    category: interaction ? "互動" : "家具",
    dimensions: {
      width: Math.max(0.05, maxX - minX),
      depth: Math.max(0.05, maxZ - minZ),
      height: Math.max(0.05, height),
    },
    parts,
    anchors,
    ...(interaction ? { interaction } : {}),
    ...(interactionSource?.clearance !== undefined ? { clearance: interactionSource.clearance } : {}),
    ...(interactionSource?.interactionZone !== undefined
      ? { interactionZone: interactionSource.interactionZone }
      : {}),
    icon: interactionSource?.icon ?? "🧰",
    version: 1,
    source: "user",
  };
  return { def, droppedInteractions };
}

/**
 * Part placement relations (§46-47) — 「放在◯◯上面／前面／旁邊」, so nobody
 * ever types a Z by hand. Returns the offset for a new part of `size` placed
 * relative to `base`.
 */
export function relatePartOffset(
  base: PropPart,
  size: { width: number; depth: number; height: number },
  relation: "on-top" | "in-front" | "beside",
): { x: number; y: number; z: number } {
  switch (relation) {
    case "on-top":
      return { x: base.offset.x, y: base.offset.y + base.size.height, z: base.offset.z };
    case "in-front":
      return {
        x: base.offset.x,
        y: 0,
        z: base.offset.z + base.size.depth / 2 + size.depth / 2 + 0.05,
      };
    case "beside":
    default:
      return {
        x: base.offset.x + base.size.width / 2 + size.width / 2 + 0.05,
        y: 0,
        z: base.offset.z,
      };
  }
}

/** §48: warn on parts that visibly interpenetrate (same-axis box overlap). */
export function overlappingParts(parts: readonly PropPart[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i];
      const b = parts[j];
      const overlap = (pa: number, sa: number, pb: number, sb: number) =>
        Math.abs(pa - pb) < (sa + sb) / 2 - 0.01;
      const ya = a.offset.y + a.size.height / 2;
      const yb = b.offset.y + b.size.height / 2;
      if (
        overlap(a.offset.x, a.size.width, b.offset.x, b.size.width)
        && overlap(a.offset.z, a.size.depth, b.offset.z, b.size.depth)
        && overlap(ya, a.size.height, yb, b.size.height)
      ) {
        out.push([a.id, b.id]);
      }
    }
  }
  return out;
}

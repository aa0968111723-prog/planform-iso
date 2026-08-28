/**
 * The bridge between a PropDefinition and the systems that already exist.
 *
 * A definition is persisted in `Project.props`; the SCENE, the VALIDATOR and
 * the 場刊圖 never read it directly — they read a plain catalog entry, exactly
 * as they do for every booth asset and every GLB import. This module derives
 * that entry, ONE WAY: the entry is regenerated from the definition on every
 * edit and is never hand-modified, because two persisted copies of a name or
 * a dimension will drift, and drift between "what the panel says" and "what
 * the export prints" is the class of bug this repo keeps having to buy back.
 *
 * Why an entry at all (and not a new render path): an older build strips the
 * `props` block on resave, but it keeps catalogExtras whose `kind` stays
 * inside the original eight ObjectKinds. So a plan full of custom props opens
 * there as placeable, validatable, exportable grey boxes — degraded, not
 * broken. That is the booth catalog's compatibility trick, reused verbatim.
 */

import type { AssetCatalogEntry } from "./catalog";
import type { PropDefinition, ProjectCatalogExtra } from "./model";

/** The assetId / catalog id a definition mirrors to. */
export function propEntryId(def: Pick<PropDefinition, "id">): string {
  return `custom:${def.id}`;
}

/** The visualRef the scene dispatches on. */
export function propVisualRef(def: Pick<PropDefinition, "id">): string {
  return `prop:${def.id}`;
}

/**
 * Category → the eight-kind vocabulary an old build understands.
 * Everything defaults to "table": a floor-standing block with a footprint,
 * which is what a grey-box prop degrades to.
 */
function kindForProp(def: PropDefinition): ProjectCatalogExtra["kind"] {
  const flat = def.dimensions.height <= 0.1;
  if (flat) return "mat";
  return "table";
}

/**
 * Derive the mirrored catalog entry. Pure; called on every definition edit.
 * `version` is copied from the definition — the scene's rebuild signature
 * includes it, which is what makes placed instances redraw after an edit.
 */
export function entryFromProp(def: PropDefinition): AssetCatalogEntry {
  const kind = kindForProp(def);
  return {
    id: propEntryId(def),
    name: def.name,
    semanticType: "other",
    sourceType: "generated-procedural",
    category: "custom",
    placementType: "floor",
    dimensions: { ...def.dimensions },
    defaultFacingDeg: 0,
    clearanceFront: def.clearance ?? 0,
    blocksFlow: def.dimensions.height > 0.1,
    serviceRole: "none",
    kind,
    icon: def.icon ?? "🎲",
    color: def.parts[0]?.color ?? "#8fb4c9",
    visualRef: propVisualRef(def),
    planSymbolRef: `plan:prop:${def.id}`,
    tags: ["custom", "prop", def.category],
    createdBy: "studio",
    version: def.version,
    allowCustomSize: false,
  };
}

/**
 * Regenerate every mirrored entry inside a project's catalogExtras.
 *
 * Non-prop extras (booth assets, GLB imports) pass through untouched; stale
 * prop entries whose definition is gone are removed — an entry without its
 * definition is a lie about what the plan contains.
 */
export function syncPropEntries(
  extras: ProjectCatalogExtra[] | undefined,
  props: PropDefinition[] | undefined,
): ProjectCatalogExtra[] {
  const kept = (extras ?? []).filter((e) => !e.tags?.includes("prop"));
  const generated = (props ?? []).map((def) => entryFromProp(def) as unknown as ProjectCatalogExtra);
  return [...kept, ...generated];
}

/** Find the definition a placed object points at, if any. */
export function propForAssetId(
  props: PropDefinition[] | undefined,
  assetId: string | undefined,
): PropDefinition | undefined {
  if (!assetId || !assetId.startsWith("custom:prop_")) return undefined;
  const id = assetId.slice("custom:".length);
  return props?.find((d) => d.id === id);
}

/**
 * PropDefinition → one three.js Group.
 *
 * The only data-driven geometry in the repo: everything else is a hand-written
 * factory. Parts are four primitives with a material preset, an optional tint,
 * and an optional painted front face (text or an image). A dice or spinner
 * part can declare `facesFromOptions`, in which case its faces are rendered
 * from a bound station's chance options — the ONE record that also drives the
 * panel row and the result display, so the 3D face can never disagree with
 * the question behind it.
 *
 * Performance contract (set here, not discovered at the end):
 * - one prop compiles to ONE Group, target ≤12 meshes, hard cap 24 — the
 *   quality gate counts meshes as materials and fails mobile above that;
 * - built groups are cached by `id@version` and the stale version is dropped
 *   on write (definitions are editable; the cache must follow);
 * - painted faces reuse one CanvasTexture per distinct content string.
 *
 * Images are painted synchronously as a colour block first and upgraded when
 * the blob arrives — the same degrade-then-upgrade shape as GLB rehydration.
 */

import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
} from "three";
import { materialFromPreset, MATERIAL_PRESETS, type MaterialPresetId } from "./materials";
import type { InteractionOption, PropDefinition, PropPart } from "../core/model";

/** The finish vocabulary the UI offers, mapped to material presets (§8). */
export const FINISH_CHOICES: { id: MaterialPresetId; label: string }[] = [
  { id: "plastic-matte", label: "霧面" },
  { id: "plastic-gloss", label: "亮面" },
  { id: "light-wood", label: "木質" },
  { id: "brushed-metal", label: "金屬" },
  { id: "fabric", label: "布面" },
  { id: "mat-soft", label: "巧拼／泡棉" },
  { id: "paper", label: "紙面" },
  { id: "screen-glass", label: "螢幕" },
];

export const PROP_MESH_BUDGET = 24;

function finishOf(part: PropPart): MaterialPresetId {
  const id = part.finish as MaterialPresetId | undefined;
  return id && id in MATERIAL_PRESETS ? id : "plastic-matte";
}

// --- painted faces -----------------------------------------------------------

const faceTextureCache = new Map<string, CanvasTexture>();

/**
 * A canvas texture carrying text over a colour. One per distinct content
 * string; the scene shares them across parts and props.
 */
function paintedTexture(text: string, background: string, color = "#1f2937"): CanvasTexture {
  const key = `${text}|${background}|${color}`;
  const cached = faceTextureCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 256, 256);
  if (text) {
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Shrink to fit; CJK has no spaces to wrap on, and a face label is short.
    let size = 64;
    ctx.font = `700 ${size}px system-ui, 'Noto Sans TC', sans-serif`;
    while (size > 18 && ctx.measureText(text).width > 230) {
      size -= 6;
      ctx.font = `700 ${size}px system-ui, 'Noto Sans TC', sans-serif`;
    }
    ctx.fillText(text, 128, 128);
  }
  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  faceTextureCache.set(key, texture);
  return texture;
}

function paintedMaterial(text: string, background: string): MeshStandardMaterial {
  return new MeshStandardMaterial({
    map: paintedTexture(text, background),
    roughness: 0.85,
    metalness: 0.02,
  });
}

// --- part builders -----------------------------------------------------------

function baseMaterial(part: PropPart): MeshStandardMaterial {
  return materialFromPreset(finishOf(part), part.color);
}

/**
 * The six face materials of a `facesFromOptions` box, one per option in order.
 * three.js BoxGeometry face order: +x, -x, +y, -y, +z, -z. The option list
 * fills front (+z) first, then around, so a 2-option prop still reads from
 * the front. Fewer than six options wrap; more than six show the first six —
 * a d12's remaining faces exist in the odds, not on the box.
 */
function diceMaterials(part: PropPart, options: readonly InteractionOption[]): MeshStandardMaterial[] {
  const fallback = baseMaterial(part);
  if (!options.length) return [fallback, fallback, fallback, fallback, fallback, fallback];
  const faceOrder = [4, 5, 0, 1, 2, 3]; // fill +z first, then -z, ±x, ±y
  const mats: MeshStandardMaterial[] = new Array(6).fill(fallback);
  for (let i = 0; i < 6; i++) {
    const option = options[i % options.length];
    const background = option.color ?? part.color ?? "#f4f4f5";
    mats[faceOrder[i]] = paintedMaterial(option.label ?? "", background);
  }
  return mats;
}

function buildPart(part: PropPart, options: readonly InteractionOption[] | undefined): Mesh {
  const { width, depth, height } = part.size;
  let mesh: Mesh;
  switch (part.shape) {
    case "cylinder": {
      mesh = new Mesh(
        new CylinderGeometry(width / 2, width / 2, height, 24),
        baseMaterial(part),
      );
      break;
    }
    case "sphere": {
      mesh = new Mesh(new SphereGeometry(width / 2, 20, 14), baseMaterial(part));
      break;
    }
    case "plane": {
      // A standing face (poster, sign board). Painted when it carries content.
      const material = part.text || part.imageBlobId
        ? paintedMaterial(part.text ?? "", part.color ?? "#f8fafc")
        : baseMaterial(part);
      mesh = new Mesh(new PlaneGeometry(width, height), material);
      break;
    }
    case "box":
    default: {
      const material = part.facesFromOptions && options
        ? diceMaterials(part, options)
        : part.text
          ? [
            baseMaterial(part), baseMaterial(part), baseMaterial(part),
            baseMaterial(part), paintedMaterial(part.text, part.color ?? "#f8fafc"),
            baseMaterial(part),
          ]
          : baseMaterial(part);
      mesh = new Mesh(new BoxGeometry(width, height, depth), material as never);
      break;
    }
  }
  // Part offsets are floor-centre based; three.js geometry is centred.
  const lift = part.shape === "plane" ? height / 2 : part.shape === "sphere" ? width / 2 : height / 2;
  mesh.position.set(part.offset.x, part.offset.y + lift, part.offset.z);
  if (part.rotationDeg) mesh.rotation.y = (part.rotationDeg * Math.PI) / 180;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// --- the compiler ------------------------------------------------------------

export interface PropBuildContext {
  /** The bound station's chance options, for facesFromOptions parts. */
  faceOptions?: readonly InteractionOption[];
}

/** Compile a definition into one Group. Pure of caches; see buildPropGroupCached. */
export function buildPropGroup(def: PropDefinition, ctx: PropBuildContext = {}): Group {
  const group = new Group();
  group.name = `prop:${def.id}`;
  const parts = def.parts.slice(0, PROP_MESH_BUDGET);
  for (const part of parts) {
    group.add(buildPart(part, ctx.faceOptions));
  }
  return group;
}

/** How many meshes a definition compiles to — the budget the tests pin. */
export function propMeshCount(def: PropDefinition): number {
  return Math.min(def.parts.length, PROP_MESH_BUDGET);
}

// --- versioned cache ---------------------------------------------------------

interface CachedProp {
  version: number;
  /** Face-content fingerprint: options change → faces change → rebuild. */
  faceKey: string;
  group: Group;
}

const propGroupCache = new Map<string, CachedProp>();

function faceKeyOf(options: readonly InteractionOption[] | undefined): string {
  if (!options?.length) return "";
  return options.map((o) => `${o.label}|${o.color ?? ""}|${o.imageBlobId ?? ""}`).join("¦");
}

/**
 * The cached compiler the scene calls on every sync. Keyed by definition id;
 * a version bump or a face edit drops the stale build — definitions are
 * editable, so unlike the repo's other visual caches this one must let go.
 */
export function buildPropGroupCached(def: PropDefinition, ctx: PropBuildContext = {}): Group {
  const faceKey = faceKeyOf(ctx.faceOptions);
  const cached = propGroupCache.get(def.id);
  if (cached && cached.version === def.version && cached.faceKey === faceKey) {
    return cached.group.clone(true);
  }
  const group = buildPropGroup(def, ctx);
  propGroupCache.set(def.id, { version: def.version, faceKey, group });
  return group.clone(true);
}

export function clearPropGroupCache(): void {
  propGroupCache.clear();
}

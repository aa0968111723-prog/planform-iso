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
  Euler,
  Group,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Texture,
} from "three";
import { getAssetBlobStore } from "../assets/idbStore";
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
function paintedTexture(
  text: string,
  background: string,
  color = "#1f2937",
  halfTurn = false,
): CanvasTexture {
  const key = `${text}|${background}|${color}|${halfTurn ? "r" : ""}`;
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
    if (halfTurn) {
      ctx.translate(128, 128);
      ctx.rotate(Math.PI);
      ctx.translate(-128, -128);
    }
    ctx.fillText(text, 128, 128);
  }
  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  faceTextureCache.set(key, texture);
  return texture;
}

function paintedMaterial(text: string, background: string, halfTurn = false): MeshStandardMaterial {
  return new MeshStandardMaterial({
    map: paintedTexture(text, background, undefined, halfTurn),
    roughness: 0.85,
    metalness: 0.02,
  });
}

/**
 * Artwork painted on a face, from a blob the user imported.
 *
 * `PropPart.imageBlobId` was documented as "image blob painted on the front
 * face" and the plane branch even TESTED for it — then called
 * `paintedMaterial(part.text ?? "", …)` and dropped it on the floor. The field
 * existed, the check existed, and nothing ever loaded an image. That is the
 * same shape of lie as a tool returning ok:true without doing anything.
 *
 * Loading is async (IndexedDB, then decode) while the scene graph is built
 * synchronously, so the mesh is created with the painted fallback and the map
 * is swapped in when the bytes arrive. A missing or undecodable blob keeps the
 * fallback: a backdrop with no artwork yet should look like a blank backdrop,
 * not vanish.
 */
const artworkCache = new Map<string, Promise<Texture | null>>();

async function loadArtwork(blobId: string): Promise<Texture | null> {
  const rec = await getAssetBlobStore().getBlob(blobId);
  if (!rec) return null;
  const blob = new Blob([rec.data], { type: rec.mimeType || "image/png" });
  try {
    // createImageBitmap decodes off the main thread and needs no object URL.
    const bitmap = await createImageBitmap(blob);
    const texture = new CanvasTexture(bitmap as unknown as HTMLCanvasElement);
    texture.minFilter = LinearFilter;
    texture.needsUpdate = true;
    return texture;
  } catch {
    return null;
  }
}

function artworkTexture(blobId: string): Promise<Texture | null> {
  let pending = artworkCache.get(blobId);
  if (!pending) {
    // A failed load is cached too: retrying on every rebuild would hammer IDB
    // for a blob that is not coming back.
    pending = loadArtwork(blobId).catch(() => null);
    artworkCache.set(blobId, pending);
  }
  return pending;
}

/** Drop cached artwork, so a re-imported image is picked up. */
export function clearArtworkCache(): void {
  for (const pending of artworkCache.values()) {
    void pending.then((t) => t?.dispose());
  }
  artworkCache.clear();
}

/**
 * Paint `part`'s artwork onto `material` once it loads.
 *
 * Fire-and-forget by design: the caller has already returned a usable mesh.
 */
function applyArtwork(material: MeshStandardMaterial, part: PropPart): void {
  if (!part.imageBlobId) return;
  const blobId = part.imageBlobId;
  void artworkTexture(blobId).then((texture) => {
    if (!texture) return;
    material.map = texture;
    // Artwork carries its own colour; leaving the panel tint multiplied over
    // it turns a white backdrop grey.
    material.color.set("#ffffff");
    material.needsUpdate = true;
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
    const slot = faceOrder[i];
    const option = options[i % options.length];
    const background = option.color ?? part.color ?? "#f4f4f5";
    // BoxGeometry's +y and -y faces carry their UVs turned a half turn from
    // the sides, so an unrotated label printed upside down on the top of the
    // dice. Turn those two textures to match.
    mats[slot] = paintedMaterial(option.label ?? "", background, slot === 2 || slot === 3);
  }
  return mats;
}

/**
 * A spinner disc: one wedge per option, coloured from the option list.
 *
 * CylinderGeometry emits three groups (side, top, bottom), so a single
 * material index cannot paint wedges. Building the top cap as a fan of
 * per-option sectors is the only way the wheel can show which segment the
 * pointer is on — and 「一份活資料」 requires that it show exactly the options
 * the panel edits, not a decorative approximation.
 */
function spinnerMesh(part: PropPart, options: readonly InteractionOption[]): Mesh {
  const { width, height } = part.size;
  const r = width / 2;
  const n = Math.max(1, options.length);
  const group = new CylinderGeometry(r, r, height, Math.max(24, n * 8));
  const body = new Mesh(group, baseMaterial(part));
  for (let i = 0; i < n; i++) {
    const wedge = new CylinderGeometry(
      r * 0.97, r * 0.97, height * 0.2, Math.max(6, Math.ceil(48 / n)), 1, false,
      (i / n) * Math.PI * 2, (1 / n) * Math.PI * 2,
    );
    const mesh = new Mesh(wedge, new MeshStandardMaterial({
      color: options[i]?.color ?? part.color ?? "#f4f4f5",
      roughness: 0.5,
      metalness: 0.02,
    }));
    mesh.position.y = height * 0.5;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    body.add(mesh);
  }
  return body;
}

function buildPart(part: PropPart, options: readonly InteractionOption[] | undefined): Mesh {
  const { width, depth, height } = part.size;
  let mesh: Mesh;
  switch (part.shape) {
    case "cylinder": {
      // §5 scopes facesFromOptions to 「骰／轉盤 part」; only the box branch
      // used to honour it, so the spinner's disc rendered as a plain yellow
      // cylinder while the panel, the §26 readout and the 場刊 all listed six
      // named wedges.
      if (part.facesFromOptions && options?.length) {
        mesh = spinnerMesh(part, options);
      } else if (part.text || part.imageBlobId) {
        // CylinderGeometry has separate material groups for its side, top and
        // bottom. Mapping the top cap makes a photo-backed 58 mm chest pin
        // read as a circular merch item from the normal top/ISO booth view,
        // instead of stretching the artwork around its rim.
        const top = paintedMaterial(part.text ?? "", part.color ?? "#f8fafc");
        applyArtwork(top, part);
        const base = baseMaterial(part);
        mesh = new Mesh(
          new CylinderGeometry(width / 2, width / 2, height, 24),
          [base, top, base] as never,
        );
      } else {
        mesh = new Mesh(
          new CylinderGeometry(width / 2, width / 2, height, 24),
          baseMaterial(part),
        );
      }
      break;
    }
    case "sphere": {
      mesh = new Mesh(new SphereGeometry(width / 2, 20, 14), baseMaterial(part));
      break;
    }
    case "plane": {
      // A standing face (poster, sign board, backdrop). Painted when it carries
      // content; artwork is swapped in over the top once its blob loads.
      const material = part.text || part.imageBlobId
        ? paintedMaterial(part.text ?? "", part.color ?? "#f8fafc")
        : baseMaterial(part);
      applyArtwork(material, part);
      mesh = new Mesh(new PlaneGeometry(width, height), material);
      break;
    }
    case "box":
    default: {
      if (part.facesFromOptions && options) {
        mesh = new Mesh(new BoxGeometry(width, height, depth), diceMaterials(part, options) as never);
      } else if (part.text || part.imageBlobId) {
        // A nameplate or merch box is a box with a photo on the front — the
        // same face the text path already paints. Artwork used to apply only
        // to planes, so a custom 桌上小物 could never show the picture the
        // Studio just accepted.
        const front = paintedMaterial(part.text ?? "", part.color ?? "#f8fafc");
        applyArtwork(front, part);
        mesh = new Mesh(new BoxGeometry(width, height, depth), [
          baseMaterial(part), baseMaterial(part), baseMaterial(part),
          baseMaterial(part), front,
          baseMaterial(part),
        ] as never);
      } else {
        mesh = new Mesh(new BoxGeometry(width, height, depth), baseMaterial(part));
      }
      break;
    }
  }
  // Named so rehearsal playback can find the dice to spin and the screen to
  // repaint inside a cloned group.
  mesh.name = `part:${part.id}`;
  // Part offsets are floor-centre based; three.js geometry is centred.
  const lift = part.shape === "plane" ? height / 2 : part.shape === "sphere" ? width / 2 : height / 2;
  mesh.position.set(part.offset.x, part.offset.y + lift, part.offset.z);
  if (part.rotationDeg) mesh.rotation.y = (part.rotationDeg * Math.PI) / 180;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// --- rehearsal animation (§25 dice, §31 displays) ----------------------------

/** How long a dice tumbles before settling on the rolled face. */
export const DICE_SPIN_SECONDS = 1.6;

const FACE_ORDER = [4, 5, 0, 1, 2, 3]; // duplicated from diceMaterials on purpose: tests pin both

/**
 * Material-slot → the rotation that turns that face upward. BoxGeometry slot
 * order is +x, -x, +y, -y, +z, -z; each entry maps that slot's normal to +y.
 * All rotations are about x or z, so the group's own y-rotation (the placed
 * object facing) cannot tilt the settled face off vertical.
 */
const SLOT_SETTLE: Quaternion[] = [
  new Quaternion().setFromEuler(new Euler(0, 0, Math.PI / 2)),   // +x up
  new Quaternion().setFromEuler(new Euler(0, 0, -Math.PI / 2)),  // -x up
  new Quaternion(),                                               // +y already up
  new Quaternion().setFromEuler(new Euler(Math.PI, 0, 0)),       // -y up
  new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0)),  // +z up
  new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, 0)),   // -z up
];

/**
 * The rotation that shows option `optionIndex` face-up, or null when that
 * option has no painted face (a d12's 7th face lives in the odds, not on the
 * box — the dice then settles back to rest and the label display carries it).
 */
export function diceSettleQuaternion(optionIndex: number): Quaternion | null {
  if (optionIndex < 0 || optionIndex >= 6) return null;
  return SLOT_SETTLE[FACE_ORDER[optionIndex]].clone();
}

/**
 * Where a spinner comes to rest: the wedge that was rolled, turned to the
 * pointer. A wheel turns about its own axis and stays flat — applying the
 * dice's slot-normal-to-+y rotations to it stood the disc on its edge for
 * five of six outcomes, floating beside the pole for the rest of the
 * rehearsal.
 */
export function spinnerSettleQuaternion(optionIndex: number, optionCount: number): Quaternion | null {
  if (optionIndex < 0 || optionCount <= 0 || optionIndex >= optionCount) return null;
  // Wedge i spans [i/n, (i+1)/n) turns; bring its centre to the pointer at +z.
  const centre = ((optionIndex + 0.5) / optionCount) * Math.PI * 2;
  return new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -centre);
}

/** A part can only settle a face UPWARD if it is a box. */
export function settleQuaternionFor(
  part: Pick<PropPart, "shape">,
  optionIndex: number,
  optionCount: number,
): Quaternion | null {
  return part.shape === "box"
    ? diceSettleQuaternion(optionIndex)
    : spinnerSettleQuaternion(optionIndex, optionCount);
}

/**
 * §25's whole animation as one pure function of playback time: 擲 → 轉 → 停.
 *
 * The dice is always the settled face rotated a further `turns` about a fixed
 * tilted axis, and that extra angle winds down to exactly zero — so the spin
 * DECELERATES into the result instead of tumbling at full speed and snapping
 * on the last frame. (The first version blended a free tumble toward the
 * settled face and could visibly lurch AWAY at 80% before jumping in; the
 * deceleration test caught it.) No physics engine, per §25.
 *
 * Deterministic: same elapsed and same serial always give the same
 * orientation, and the serial tilts the axis and the turn count so two rolls
 * of the same face do not look like a replay of each other.
 */
export function diceRollQuaternion(elapsed: number, serial: number, settle: Quaternion): Quaternion {
  const p = Math.min(1, Math.max(0, elapsed / DICE_SPIN_SECONDS));
  if (p >= 1) return settle.clone();
  // Ease-out cubic: angular velocity is proportional to (1 - p)², reaching
  // zero exactly as the face comes to rest.
  const remaining = (1 - p) ** 3;
  const turns = 2.5 + (serial % 3) * 0.5;
  const axis = new Vector3(Math.sin(serial * 1.7), 1, Math.cos(serial * 2.3)).normalize();
  const spin = new Quaternion().setFromAxisAngle(axis, turns * 2 * Math.PI * remaining);
  return spin.multiply(settle);
}

/**
 * §31: paint a rolled result onto a display part. Clones nothing until a
 * result actually lands; then the painted material belongs to THIS mesh, so
 * two screens of the same definition can show two different stations. The
 * repaint key makes this per-tick safe — same result, no work.
 */
export function paintPartResult(mesh: Mesh, part: PropPart, label: string, background: string): void {
  const key = `${label}|${background}`;
  if (mesh.userData.resultKey === key) return;
  const painted = paintedMaterial(label, background);
  if (!("baseResultMaterial" in mesh.userData)) mesh.userData.baseResultMaterial = mesh.material;
  const prev = mesh.userData.ownResultMaterial as MeshStandardMaterial | undefined;
  if (part.shape === "plane") {
    mesh.material = painted;
  } else {
    // Box: the painted face is slot 4 (+z), same as a text part's front.
    const current = mesh.material;
    const base: MeshStandardMaterial[] = Array.isArray(current)
      ? (current as MeshStandardMaterial[]).slice(0, 6)
      : new Array<MeshStandardMaterial>(6).fill(current as MeshStandardMaterial);
    while (base.length < 6) base.push(base[0]);
    base[4] = painted;
    mesh.material = base as never;
  }
  // Textures are shared via the face cache; disposing the material is safe.
  prev?.dispose();
  mesh.userData.ownResultMaterial = painted;
  mesh.userData.resultKey = key;
}

/** Put a display part back the way it was built (playback stopped). */
export function clearPartResult(mesh: Mesh): void {
  if (!("baseResultMaterial" in mesh.userData)) return;
  const own = mesh.userData.ownResultMaterial as MeshStandardMaterial | undefined;
  mesh.material = mesh.userData.baseResultMaterial as never;
  own?.dispose();
  delete mesh.userData.baseResultMaterial;
  delete mesh.userData.ownResultMaterial;
  delete mesh.userData.resultKey;
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

/**
 * Drop every built group. Called when a project is opened.
 *
 * The cache is keyed by definition id, and §39 makes each project's copy of a
 * library prop an independently edited SNAPSHOT — so two projects can hold the
 * same id at the same version with different parts, and without this the
 * second project's build was served to the first.
 *
 * It deliberately does NOT dispose. `buildPropGroupCached` hands out
 * `clone(true)`, and three.js clones SHARE geometry with their source — so
 * disposing the cached original would delete the GPU buffers out from under
 * every placed copy still in the scene. The scene disposes its own nodes when
 * they leave (`syncObjects`), which is where those geometries actually die;
 * here we only drop references and let GC take the rest.
 */
export function clearPropGroupCache(): void {
  propGroupCache.clear();
}

/**
 * Release a built group's geometries. Materials come from shared caches and
 * stay.
 *
 * Only safe for a group nobody cloned — the preview's own build, which it
 * replaces on every keystroke. Never call it on a cached group; see
 * `clearPropGroupCache`.
 */
export function disposePropGroup(group: Group): void {
  group.traverse((node) => {
    if (node instanceof Mesh) node.geometry.dispose();
  });
}

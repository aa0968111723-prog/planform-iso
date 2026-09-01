/**
 * Local-first project data model. All spatial values are in meters
 * (1 Three.js unit = 1 meter). Angles are in degrees; an object's rotationDeg
 * is its yaw about +Y and also defines the direction it faces (0 = facing +Z).
 *
 * v2: semantic placement (surface / elevation / parent / wall / door) + arrays.
 * v3: measurements + validation settings.
 * v4: visual-comm — description, zone icon/capacity, route type + zone links.
 * v5: Asset Catalog — optional assetId / serviceRole; custom catalogExtras.
 * v6: Event Flow — ServiceStation / EventScenario for DES simulation.
 * v7: E310 venue identity + three independent field-calibration confirmations.
 * v8: stable project identity (`id`) + optional event date — a project library
 *     needs a key that is not the display name, because two events can share a
 *     name and a rename must not orphan the file.
 *
 * Outdoor booth simulation (攤位模擬) adds NO version: every field it needs is
 * optional (`Project.booth`, `Zone.boothRole`, `Route.boothRole`) and its
 * assets are `custom:*` catalogExtras whose `kind` stays inside the original
 * eight. An older build reading a booth file ignores the extra fields and
 * still draws the tent, tables, zones and routes.
 */

export const PROJECT_VERSION = 8;

export type ServiceRole = "checkin" | "payment" | "guidance" | "storage" | "none";

export interface AreaConfig {
  id: "classroom" | "corridor";
  name: string;
  length: number; // +X, meters
  width: number; // +Z, meters
  x: number; // north-west corner, meters
  z: number;
}

export interface TileConfig {
  width: number; // meters (+X)
  depth: number; // meters (+Z)
  originX: number;
  originZ: number;
  rotationDeg: number;
  visible: boolean;
}

export interface Calibration {
  referenceLength: number | null;
  note: string;
  /** Independent on-site confirmations; missing means not yet confirmed. */
  confirmed: {
    tile?: boolean;
    door?: boolean;
    room?: boolean;
  };
}

export type ObjectKind =
  | "computer"
  | "door"
  | "switch"
  | "screen"
  | "table"
  | "chair"
  | "mat"
  | "regTable";

export type Surface = "floor" | "wall" | "tabletop";
export type WallEdge = "n" | "s" | "e" | "w";
export type HingeSide = "left" | "right";
/** Persisted presentation mode; it never changes or deletes the object itself. */
export type LabelDisplayMode = "essential" | "selected" | "all" | "none";

/** A label is presentation data, separate from an object's internal id/name. */
export interface ObjectLabelPosition {
  offsetX: number;
  offsetY: number;
  offsetZ: number;
}

export interface ObjectLabelStyle {
  fontSize?: number;
  color?: string;
  background?: string;
}

export interface WallAnchor {
  areaId: "classroom" | "corridor";
  edge: WallEdge;
  /** Distance (meters) along the wall from its min corner to the object center. */
  offset: number;
}

export interface SceneObject {
  id: string;
  kind: ObjectKind;
  x: number; // center, meters
  z: number;
  rotationDeg: number; // yaw = facing (0 faces +Z)
  width: number; // meters (+X before rotation)
  depth: number; // meters (+Z before rotation)
  height: number; // meters (+Y)
  locked: boolean;
  hidden: boolean;

  // v2 semantic placement
  surface: Surface;
  elevation: number; // base above floor (meters)
  parentId?: string; // tabletop host
  presetId?: string;
  note?: string;
  wallAnchor?: WallAnchor;

  // door-specific
  hinge?: HingeSide;
  openInward?: boolean;
  openDeg?: number;

  // v4 Asset Catalog
  /** Catalog entry id (builtin:kind or custom:*). */
  assetId?: string;
  serviceRole?: ServiceRole;

  // Precision-layout additions. They are optional on the type so a project
  // produced by an older build remains source-compatible; migrateObject gives
  // every loaded object a concrete, safe value.
  /** Internal/working name — distinct from the visible annotation. */
  name?: string;
  /** User-facing annotation text. Falls back to the catalog name when absent. */
  label?: string;
  showLabel?: boolean;
  labelPosition?: ObjectLabelPosition;
  labelStyle?: ObjectLabelStyle;
  /** Higher values win ties in overlap picking and the object panel ordering. */
  layer?: number;
  /** Non-destructive grouping for moving/selecting related objects together. */
  groupId?: string;
  opacity?: number;
  collisionEnabled?: boolean;
  snapEnabled?: boolean;
  /** Keep tabletop items inside their host by default; opt out for banners etc. */
  allowTabletopOverflow?: boolean;
  customProperties?: Record<string, string>;
  createdAt?: number;
  updatedAt?: number;
}

export type NumberOrder = "row" | "col";
export type NumberStart = "nw" | "ne" | "sw" | "se";

/** A repeated layout (e.g. a mat block or a chair grid) kept as one editable unit. */
export interface ArrayGroup {
  id: string;
  name: string;
  sourceKind: ObjectKind;
  rows: number; // along +Z
  cols: number; // along +X
  itemWidth: number;
  itemDepth: number;
  itemHeight: number;
  gapX: number;
  gapZ: number;
  rotationDeg: number;
  anchorX: number; // min-corner anchor (meters), pre-rotation
  anchorZ: number;
  locked: boolean;
  hidden: boolean;
  // v3 construction numbering
  numberPrefix: string; // e.g. "A" → A-01
  numberOrder: NumberOrder; // row-first or column-first
  numberStart: NumberStart; // which corner is #1
}

export type MeasurementType = "free-distance" | "wall-clearance" | "object-gap" | "aisle-width";

/** A persistent (or session) on-canvas dimension line. */
export interface MeasurementAnnotation {
  id: string;
  type: MeasurementType;
  start: { x: number; z: number };
  end: { x: number; z: number };
  label?: string;
  locked: boolean;
  visible: boolean;
  color: string;
}

/** User-configurable field rules (thresholds, not legal standards). */
export interface ValidationSettings {
  minAisleWidth: number; // meters
  doorFrontClearance: number; // extra meters kept clear in front of a door
  matWallClearance: number; // min meters between mats and walls
  checkScreenView: boolean;
  checkZoneRouteIntrusion: boolean;
}

export const DEFAULT_VALIDATION_SETTINGS: ValidationSettings = {
  minAisleWidth: 0.9,
  doorFrontClearance: 0.6,
  matWallClearance: 0.3,
  checkScreenView: true,
  checkZoneRouteIntrusion: true,
};

export type ZoneType =
  | "registration"
  | "payment"
  | "life"
  | "group"
  | "meditation"
  | "shoe"
  | "backpack"
  | "custom";

export interface Zone {
  id: string;
  type: ZoneType;
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  color: string;
  locked: boolean;
  hidden: boolean;
  icon: string;
  /** Optional people capacity, shown on the zone label for quick comprehension. */
  capacity: number | null;
  /**
   * Booth semantics (optional). A build without booth support reads these
   * zones as plain `type: "custom"` areas and still draws them correctly.
   */
  boothRole?: BoothZoneRole;
}

export interface RoutePoint {
  x: number;
  z: number;
}

export type RouteType =
  | "entry" | "registration" | "payment" | "shoe" | "backpack" | "seating" | "group" | "staff" | "custom";

export interface Route {
  id: string;
  name: string;
  color: string;
  points: RoutePoint[];
  visible: boolean;
  type: RouteType;
  /** Optional zone associations so a route can be re-checked when zones move. */
  startZoneId?: string;
  endZoneId?: string;
  waypointZoneIds?: string[];
  /** Booth: whose flow this is, so visitor and staff lines can be toggled together. */
  boothRole?: "visitor" | "staff";
}

export type ViewName = "iso" | "top" | "front" | "left" | "right";

export interface LayerVisibility {
  areas: boolean;
  zones: boolean;
  objects: boolean;
  tiles: boolean;
  routes: boolean;
}

// --- v6 Event Flow -------------------------------------------------------

export type StationType =
  | "entrance"
  | "guide"
  | "queue"
  | "checkin"
  | "payment"
  | "shoe"
  | "backpack"
  | "seating"
  | "group"
  | "custom";

export interface ServiceStation {
  id: string;
  name: string;
  type: StationType;
  zoneId?: string;
  objectId?: string;
  routeWaypoint?: { routeId: string; index: number };
  staffCount: number;
  parallelServers: number;
  meanServiceSeconds: number;
  /** Optional branch-specific duration, used by a shared desk variant. */
  profileServiceSeconds?: Partial<Record<ParticipantProfileId, number>>;
  serviceVariance?: number;
  queueCapacity: number;
  /** Spatial position in meters (derived from zone/object when bound). */
  x: number;
  z: number;
}

/**
 * Widened from a four-value union to a string.
 *
 * Runtime behaviour is unchanged — "prepaid" / "pay-on-site" are still the ids
 * the classroom scenario uses, and they must stay verbatim because
 * `arrivalMix.test.ts` reads `profileId` out of the playback to check that the
 * 40/20 mix really arrives mixed. The widening exists so a compiled
 * interaction template can name its own audience segments.
 *
 * Not a version bump: it changes nothing in any saved file.
 */
export type ParticipantProfileId = string;

export interface ParticipantProfile {
  id: ParticipantProfileId;
  /** Fraction of participants using this profile (0–1). Ratios are normalized. */
  ratio: number;
  /** Ordered station ids for this profile's branch. */
  branch: string[];
}

export type ArrivalProfile = "uniform" | "front-loaded";

export interface SimulationDoor {
  id: string;
  x: number;
  z: number;
  width: number;
  /** 1 is unobstructed; lower values represent a narrower or blocked passage. */
  throughput: number;
  blocked: boolean;
}

export interface SimulationSpatial {
  routes: Route[];
  corridor: AreaConfig;
  classroom: AreaConfig;
  doors: SimulationDoor[];
  /**
   * Entry / exit rectangles.
   *
   * With these, "the queue is blocking the entrance" is a fact that can be
   * stated from geometry. Without them the only way to notice is a sampled
   * congestion accumulator — and a sampled answer changes with `sampleDt`,
   * which would let the rendering detail quietly move the statistics.
   */
  zones?: { id: string; name: string; x: number; z: number; width: number; depth: number }[];
}

export interface EventScenario {
  id: string;
  name: string;
  participantCount: number;
  arrivalWindowSeconds: number;
  arrivalProfile: ArrivalProfile;
  profiles: ParticipantProfile[];
  stations: ServiceStation[];
  seed: number;
  settings: { speedMetersPerSecond: number };
  spatial?: SimulationSpatial;
}

// --- Outdoor booth (攤位模擬) ---------------------------------------------
//
// Everything here is optional on Project. The booth prototype models an
// outdoor 3×3 m tent stall rather than a classroom, but reuses the same
// objects / zones / routes so export, import, partner mode and the plan
// exporters all keep working without a single special case.

export type BoothZoneRole =
  | "staff" | "visitor" | "queue" | "interact" | "calm" | "entry" | "exit";

export type BoothStationType =
  | "board" | "queue" | "talk" | "flyer" | "game" | "form" | "cushion" | "photo";

export interface BoothStation {
  id: string;
  name: string;
  /** Reuses the existing StationType bucket; booth stations are always "custom". */
  type: StationType;
  /** Booth-specific role. An older build ignores it and sees a custom station. */
  boothType: BoothStationType;
  x: number; // meters
  z: number;
  staffCount: number;
  /** How many visitors this station can serve at once. */
  parallelServers: number;
  /** Mean dwell / service time in seconds. */
  meanServiceSeconds: number;
  queueCapacity: number;
  /** Defaults to true; false takes the station out of the visitor journey. */
  enabled?: boolean;
}

export interface BoothParams {
  visitorCount: number;
  arrivalPerMin: number;
  /** Mean seconds at the 與工作人員對談 station. */
  talkSeconds: number;
  queueCapacity: number;
  deskStaff: number;
  boardDwell: number;
  gameDwell: number;
  /** When false nobody gives up: everyone queues to the end. */
  balk: boolean;
}

export type BoothScenarioId = "normal" | "peak";

export interface BoothConfig {
  stations: BoothStation[];
  scenarioId: BoothScenarioId;
  params: BoothParams;
}

// --- Interaction flow (互動流程) -----------------------------------------
//
// Every flow this tool rehearses is "an ordered list of steps, a few of which
// fork". Getting into a classroom (check in → pay → shoes → sit down) is that
// shape, and so is a campus booth (walk past → stop → join → queue → play →
// leave). The only real differences are that a classroom forks once at the
// door (prepaid / paying now) while a booth forks mid-flow (which face, which
// option), and that everyone invited to a classroom turns up while most people
// passing a booth are only passing. Everything else — queueing, parallel
// servers, service time, walking between stations, doors, corridor overflow —
// was always shared.
//
// So the core has three primitives and no Dice, no Quiz, no Booth:
//   step   — one person, in one place, doing one thing, for a while
//   chance — a weighted fork (a dice face, an option, do-it / skip-it)
//   match  — a result looked up from earlier answers (the 4×4 OK 蹦 table)
//
// The activity the club actually runs is 「心情 OK 蹦」: several questions,
// options per question, the combination choosing the outcome, free writing in
// the middle, a physical card at the end. Hard-code the core as a DiceEngine
// or a QuizEngine and that real activity cannot be expressed — which is the
// reason this model has the shape it has.
//
// What the engine reads (weight / seconds / next) and what a person reads
// (label / prompt / result text) are separate fields, so adding a sixteenth
// quote never touches the engine.

/** One weighted option: a face of a dice, an answer, or 「do it」/「skip it」. */
export interface InteractionOption {
  id: string;
  /** 「還算喜歡」「拖延獸」. The organiser's own words; never hard-coded. */
  label: string;
  /** This face's own question or line. Content only — editing it never moves a number. */
  prompt?: string;
  /** Relative weight, normalised within the step. [1,1,1,1] is a fair four-sided dice. */
  weight: number;
  /** Extra seconds this face costs on top of the step's own time. */
  extraSeconds?: number;
  /** Recorded under `ChanceBranch.record` for later `match` steps. Defaults to `id`. */
  value?: string;
  /** undefined = use the step's own next; null = the visitor leaves here. */
  next?: string | null;
  /**
   * How this face LOOKS — a dice face's colour, a spinner segment's fill, the
   * uploaded picture on the face. Content, never machinery: a prop part with
   * `facesFromOptions` renders these, and editing them moves no number.
   *
   * They live HERE, not on the prop part, so there is exactly one record per
   * face: the same option drives the 3D face, the panel row, the result
   * display and any 連動 — the split-brain of editing a face's question in one
   * place and its picture in another is ruled out structurally.
   */
  color?: string;
  imageBlobId?: string;
}

/** A random fork. One roll, one rng() draw, and only when there is a real choice. */
export interface ChanceBranch {
  kind: "chance";
  options: InteractionOption[];
  /** Remember the chosen option's value under this key, for a later `match`. */
  record?: string;
}

/** One cell of an outcome table. `when` is matched in `MatchBranch.on` order; "*" is any. */
export interface MatchRule {
  when: string[];
  /** The cell, short enough for a readout line: 「疲憊 × 未來」. */
  label: string;
  /**
   * What is actually printed or said — the quote on the card, the wording of
   * the prize. Same split as `InteractionOption.label` / `.prompt`: one is the
   * name a count is reported under, the other is content, and editing content
   * never moves a number.
   */
  prompt?: string;
  extraSeconds?: number;
  next?: string | null;
}

/**
 * An outcome table: earlier answers decide what happens now.
 *
 * A lookup, not a roll, so it consumes NO randomness. That is deliberate:
 * which quote you get does not change how long you stand at the table, and
 * rolling for it would only make the same plan produce different queue lengths
 * on every run without buying a single piece of real information.
 */
export interface MatchBranch {
  kind: "match";
  /** Record keys to look up, in order. ["q1","q3"] is a two-dimensional table. */
  on: string[];
  rules: MatchRule[];
  otherwise?: Omit<MatchRule, "when">;
}

export type InteractionBranch = ChanceBranch | MatchBranch;

export interface InteractionStep {
  id: string;
  /** The organiser's own words: 「歡迎」「Q1 科系真心話」「領 OK 蹦小卡」. */
  name: string;
  /** Where it happens. Omitted = wherever the step that led here happened. */
  stationId?: string;
  /** Mean seconds. 0 is legal — a pure fork costs no time. */
  avgSeconds: number;
  /**
   * Spread of the duration. This is a VARIANCE, not seconds — same name and
   * same meaning as `ServiceStation.serviceVariance` (the engine takes its
   * square root as σ, defaulting to `avgSeconds * 0.2`).
   *
   * Deliberately not changed to "seconds": compiling a classroom scenario
   * copies `station.serviceVariance` verbatim, and a seconds field would mean
   * a sqrt-then-square round trip whose float drift would stop E310 being
   * bit-identical. The panel shows 「大約差幾秒」 and squares on the way in.
   */
  serviceVariance?: number;
  /** The question or instruction. Shown in the panel, printed on the 場刊圖. */
  prompt?: string;
  branch?: InteractionBranch;
  /** What to bring for this step, printed on the 場刊圖 (cards, pens, a stamp). */
  supplies?: string[];
  /**
   * undefined = the next row of `steps` — THE LIST ORDER IS THE FLOW
   * null      = this visitor is finished and leaves
   * string    = jump to a named step (only skip options and table results write this)
   *
   * This one rule is what lets a plain reorderable list carry a real branching
   * flow without becoming a node editor: ↑/↓ swap two array entries and the
   * flow genuinely changes, duplicate and delete need no edge repair, and
   * nothing hides in a graph the organiser cannot see.
   */
  next?: string | null;
}

/**
 * Where a step happens. Structurally a ServiceStation, so simSpatial's
 * `queuePlacement` and `buildTravelPath` take it with no adapter.
 */
export interface InteractionStation extends ServiceStation {
  /** Which role staffs it. Omitted → see `selfService`, then the old staffCount rule. */
  staffRoleId?: string;
  /**
   * Nobody needs to staff this step (flipping a card, writing your own
   * sentence).
   *
   * It has to be its own field. `effectiveServers` returns 0 when
   * `staffCount <= 0`, so expressing a self-service step as "zero staff" would
   * jam every visitor there forever; and giving it a fake staff member would
   * make the staff-load line claim a human is 「一直有事做」 at a step where
   * nobody is serving anyone.
   */
  selfService?: boolean;
  /** Walk away if the queue is already this long on arrival. Omitted = nobody balks. */
  balkQueueLength?: number;
  /**
   * Where people stand relative to the bound object, in the OBJECT's local
   * frame (metres; rotated by the object's rotationDeg at resolve time).
   *
   * Seeded from the prop definition's player anchor when the prop is placed,
   * then owned by this station — two copies of one dice table can face
   * different walls. Absent = the station sits at the object's centre, which
   * is byte-for-byte what every pre-prop plan already does.
   */
  anchorOffset?: { x: number; z: number };
  /**
   * Which way the queue extends from this station, degrees (0 = +Z, matching
   * rotationDeg). Absent = the room-side heuristic queuePlacement has always
   * used — the classroom path never sets this, so the frozen parity runs
   * cannot see it.
   */
  queueDirectionDeg?: number;
}

export interface StaffRole {
  id: string;
  /** 招呼 / 主持 / 陪聊 — free text. The core never makes this an enum. */
  name: string;
  count: number;
}

/**
 * A fixed split decided on arrival — this is the classroom's ParticipantProfile.
 * Whole people are allocated by largest remainder, no dice, exactly as today.
 */
export interface AudienceSegment {
  id: string;
  name: string;
  /** Relative share, normalised. */
  share: number;
  startStepId: string;
}

export interface InteractionAudience {
  /** People who pass by in this window. A booth: passers-by. A class: invitees. */
  count: number;
  windowSeconds: number;
  profile: ArrivalProfile;
  /** 0–1. How many of those passing stop to look. An invited event is 1. */
  stopRate: number;
  /** 0–1. How many of those who stopped actually join. An invited event is 1. */
  joinRate: number;
  /**
   * Seconds of queueing before someone gives up. 0 = nobody leaves.
   *
   * A fixed number, not a sampled one: drawing a personal patience would cost
   * another rng() call and buy a distribution nobody has measured, while
   * adding one more reason for the same plan to answer differently twice.
   */
  patienceSeconds: number;
}

export interface InteractionTemplate {
  id: string;
  name: string;
  /** Free note; printed under the step table on the 場刊圖. */
  note?: string;
  steps: InteractionStep[];
  startStepId: string;
  stations: InteractionStation[];
  staff: StaffRole[];
  audience: InteractionAudience;
  segments: AudienceSegment[];
  seed: number;
  settings: { speedMetersPerSecond: number };
  spatial?: SimulationSpatial;
}

// --- Prop Studio (互動道具) ------------------------------------------------
//
// A prop is a DEFINITION — "the club's 60 cm six-sided dice" — and a placed
// prop is a plain SceneObject whose assetId points at the definition's
// mirrored catalog entry. There is no PropInstance type: position, rotation,
// size and hidden already live on SceneObject, and adding fields there would
// be stripped by migrateObject's whitelist anyway.
//
// The three payloads are all optional because they answer different questions:
//   parts        — what it LOOKS like (data-driven geometry; a mat has only this)
//   anchors      — where PEOPLE stand around it (seeded onto the station)
//   interaction  — what HAPPENS there (a station + steps fragment, compiled
//                  into project.interaction on placement; after that the
//                  project's copy is the live one and this is just the seed —
//                  the same freeze-the-source rule the booth block follows)

/** One primitive a prop is built from. */
export interface PropPart {
  id: string;
  shape: "box" | "cylinder" | "sphere" | "plane";
  /** Part size in metres. A cylinder reads width as diameter; a sphere ignores depth. */
  size: { width: number; depth: number; height: number };
  /** Offset of the part's floor-centre from the prop's floor-centre, metres. */
  offset: { x: number; y: number; z: number };
  rotationDeg?: number;
  color?: string;
  /** Material preset name (materialFromPreset vocabulary): 霧面/亮面/木質…. */
  finish?: string;
  /** Text painted on the front face (CanvasTexture billboard, not 3D type). */
  text?: string;
  /** Image blob painted on the front face. */
  imageBlobId?: string;
  /**
   * Render this part's faces from the bound station's chance options — the
   * dice's six faces, the spinner's segments. The option list is the ONE
   * record for face colour/image/label, so the 3D face can never disagree
   * with the panel.
   */
  facesFromOptions?: boolean;
  /**
   * §31 display link — during a rehearsal this part shows the latest rolled
   * option of a station. `"self"` = the prop's own bound station (the screen
   * part inside a 骰子遊戲站 assembly); any other value is a station id (a
   * standalone 互動螢幕 pointed at a placed dice). Rendering-only: the engine
   * never reads it.
   */
  showsResultOf?: string;
}

/** A place people stand, in the prop's local frame (metres, +Z = facing). */
export interface PropAnchor {
  id: string;
  role: "player" | "staff" | "queue" | "exit";
  x: number;
  z: number;
  /** For queue anchors: the direction the line extends, degrees. */
  facingDeg?: number;
}

/** The interaction a prop brings with it, as a template fragment. */
export interface PropInteractionSeed {
  /**
   * Steps in fragment-local ids. The wiring contract (enforced at
   * instantiation): the last step carries an explicit `next: null`, and every
   * internal jump is an explicit id — a fragment must never rely on row order,
   * because it is spliced into a list it does not control.
   */
  steps: InteractionStep[];
  /** Station parameters; position comes from the placed object + anchors. */
  station: Pick<
    InteractionStation,
    "meanServiceSeconds" | "parallelServers" | "queueCapacity" | "selfService"
  >;
  /** Role that staffs it, created on first placement, shared by copies. */
  staffRole?: { name: string; count: number };
  /** Probability a passer-by skips this station entirely (the ask-step fork). */
  skipRate?: number;
}

export interface PropDefinition {
  id: string;
  name: string;
  /** 素材庫分類：互動 / 家具 / 指示 / 我的道具…. */
  category: string;
  /**
   * Where a fresh copy lands. Tabletop items snap onto a desk; everything
   * else stands on the floor. Optional so older files and interactive
   * presets keep the floor default without a PROJECT_VERSION bump.
   */
  placement?: "floor" | "tabletop";
  /** Overall footprint, metres — the mirrored catalog entry's dimensions. */
  dimensions: { width: number; depth: number; height: number };
  parts: PropPart[];
  anchors: PropAnchor[];
  interaction?: PropInteractionSeed;
  /** Suggested operating space in front, metres (§61). */
  clearance?: number;
  /** Interaction zone radius, metres (§17) — visual + validation only. */
  interactionZone?: number;
  icon?: string;
  /**
   * Definition version. Bumped on every edit; the mirrored catalog entry
   * carries the same number, which is what makes the scene rebuild placed
   * instances (the rebuild signature includes entry.version).
   */
  version: number;
  /** Where it came from: builtin preset id, "user", or "import". */
  source?: string;
  /**
   * What to send to the printer, when this prop represents something printed.
   *
   * Optional exactly like `booth` and `interaction`, and like them it does NOT
   * move PROJECT_VERSION: an older build ignores the block and still draws the
   * poster as the plane it already understands. What it loses is the order
   * line, not the prop.
   *
   * Typed loosely here on purpose — `core/printSpec.ts` owns the shape, and
   * `model.ts` must not start importing sibling modules or every consumer of
   * the data model drags the print vocabulary in with it.
   */
  print?: {
    widthMm: number;
    heightMm: number;
    standard?: string;
    orientation: "portrait" | "landscape";
    sides: 1 | 2;
    material: string;
    quantity: number;
    bleedMm: number;
    finishNote?: string;
  };
  /**
   * §40 — draw this prop with an imported model instead of its `parts`.
   *
   * The upgrade path from a grey box to a real 3D dice: import a GLB, then
   * point a definition at that entry's visual. Anchors, the game and the
   * footprint are the prop's own; only the LOOK is borrowed, so the whole
   * simulation and 場刊 story is unchanged by swapping the model in or out.
   * `parts` stays as the fallback, which is what renders while the GLB is
   * still loading and in any build that cannot resolve it.
   */
  visualFrom?: string;
}

/** Custom catalog entry metadata stored in project JSON (blobs live in IndexedDB). */
export interface ProjectCatalogExtra {
  id: string;
  name: string;
  semanticType: string;
  sourceType: string;
  category: string;
  placementType: Surface;
  dimensions: { width: number; depth: number; height: number };
  defaultFacingDeg: number;
  clearanceFront: number;
  blocksFlow: boolean;
  serviceRole?: ServiceRole;
  kind: ObjectKind;
  icon: string;
  color: string;
  visualRef: string;
  planSymbolRef?: string;
  thumbnailRef?: string;
  tags: string[];
  // "studio" is what the Prop Studio's one-way mirror stamps. It was
  // missing here, so the loader rewrote every prop entry to "photo" —
  // harmless today, but proof that the derived entry is a second
  // persisted copy the loader can mutate.
  createdBy: "photo" | "import" | "agent" | "builtin" | "studio";
  version: number;
  blobIds?: { sourceImage?: string; glb?: string; thumbnail?: string };
  allowCustomSize?: boolean;
  defaultElevation?: number;
  allowedParents?: ObjectKind[];
}

export interface Project {
  version: number;
  /**
   * v8: stable identity, independent of `name`. This is the project's storage
   * key, so it must never be reused across a duplicate and must never be
   * derived from anything the user can edit.
   */
  id: string;
  name: string;
  /** v8: optional 活動日期, `YYYY-MM-DD`. Lives on the body so export, import
   *  and duplicate carry it — an index-only copy would be silently dropped. */
  eventDate?: string;
  /** Built-in venue identity, retained so honest calibration copy survives reload. */
  venuePresetId?: string;
  /** Short activity description shown in the team/partner view. */
  description: string;
  classroom: AreaConfig;
  corridor: AreaConfig;
  tile: TileConfig;
  calibration: Calibration;
  zones: Zone[];
  objects: SceneObject[];
  groups: ArrayGroup[];
  routes: Route[];
  measurements: MeasurementAnnotation[];
  validationSettings: ValidationSettings;
  view: ViewName;
  layers: LayerVisibility;
  /** Persisted label visibility policy. Individual `showLabel` values win. */
  labelDisplayMode?: LabelDisplayMode;
  /** v5: user/custom catalog entries (binary blobs referenced via blobIds). */
  catalogExtras?: ProjectCatalogExtra[];
  /** v6: event-flow simulation scenarios (DES). */
  scenarios: EventScenario[];
  activeScenarioId: string | null;
  /** Outdoor booth simulation. Absent on classroom projects. */
  booth?: BoothConfig;
  /**
   * The interaction flow. Optional exactly like `booth`, and like `booth` it
   * does NOT move PROJECT_VERSION — an older build ignores it and falls back
   * to the `booth` block still sitting in the same file.
   */
  interaction?: InteractionTemplate;
  /**
   * Prop Studio definitions used by this plan (互動道具).
   *
   * Same contract as `interaction` and `booth`: an optional block, defensive
   * migration, PROJECT_VERSION does not move. An older build strips this block
   * on resave — and the plan still opens there, because every definition also
   * mirrors a plain catalogExtras entry (kind inside the original eight) that
   * the old build can place, validate and export as a grey box. What the old
   * build cannot do is edit the prop or run its interaction; the file is
   * degraded, not broken.
   */
  props?: PropDefinition[];
}

let idCounter = 0;
export function uid(prefix = "id"): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

export const ZONE_DEFAULTS: Record<
  ZoneType,
  { label: string; color: string; width: number; depth: number; icon: string }
> = {
  registration: { label: "報到區", color: "#38bdf8", width: 2.5, depth: 1.5, icon: "👋" },
  payment: { label: "收費區", color: "#facc15", width: 2, depth: 1.5, icon: "💰" },
  life: { label: "生活組區", color: "#34d399", width: 2, depth: 2, icon: "🧺" },
  group: { label: "小組組別區", color: "#a78bfa", width: 3, depth: 3, icon: "👥" },
  meditation: { label: "講師禪定區", color: "#f472b6", width: 2, depth: 2, icon: "🧘" },
  shoe: { label: "鞋子擺放區", color: "#fbbf24", width: 2, depth: 1, icon: "👟" },
  backpack: { label: "背包放置區", color: "#fb923c", width: 2, depth: 1, icon: "🎒" },
  custom: { label: "自訂區", color: "#94a3b8", width: 2, depth: 2, icon: "📦" },
};

export function createDefaultProject(): Project {
  return {
    version: PROJECT_VERSION,
    // MUST be an inline uid() call. A module-level constant or a memoised value
    // would collapse every migrated legacy document onto ONE storage key and
    // destroy the whole library in a single pass — migrate.ts spreads this base
    // over the input, so this is the id a document without one inherits.
    id: uid("proj"),
    name: "未命名平面圖",
    description: "",
    classroom: { id: "classroom", name: "教室", length: 10, width: 8, x: 0, z: 0 },
    corridor: { id: "corridor", name: "走廊", length: 10, width: 2, x: 0, z: 8 },
    tile: { width: 0.6, depth: 0.6, originX: 0, originZ: 0, rotationDeg: 0, visible: true },
    calibration: { referenceLength: null, note: "", confirmed: {} },
    zones: [],
    objects: [],
    groups: [],
    routes: [],
    measurements: [],
    validationSettings: { ...DEFAULT_VALIDATION_SETTINGS },
    view: "top",
    layers: { areas: true, zones: true, objects: true, tiles: true, routes: true },
    labelDisplayMode: "essential",
    catalogExtras: [],
    scenarios: [],
    activeScenarioId: null,
  };
}

/**
 * Is there work in this plan that replacing it would throw away?
 *
 * Semantic comparison against a pristine `createDefaultProject()`, covering
 * every user-editable field — not just the arrays. Somebody who spent ten
 * minutes walking the room, calibrating the tile grid against a real floor
 * tile, writing what the activity is, or importing a custom asset has done
 * real work, and has not yet placed a single object.
 *
 * This started as an objects/zones/groups/routes test, grew 尺寸線 and 情境,
 * and each time the missing field was found the same way — somebody lost work.
 * So it is now written the other way round: everything counts unless it is
 * still exactly what a brand-new project ships with.
 *
 * `id` and the camera `view` are deliberately ignored: ambient, not work.
 */
export function planHasContent(project: Project): boolean {
  const pristine = createDefaultProject();

  if (project.objects.length > 0) return true;
  if (project.zones.length > 0) return true;
  if (project.groups.length > 0) return true;
  if (project.routes.length > 0) return true;
  if (project.measurements.length > 0) return true;
  if ((project.scenarios?.length ?? 0) > 0) return true;
  if ((project.catalogExtras?.length ?? 0) > 0) return true;
  // A plan whose only work is a custom prop definition is not empty — without
  // this line, 「取代目前專案」 would judge an afternoon in Prop Studio as
  // nothing worth an undo checkpoint.
  if ((project.props?.length ?? 0) > 0) return true;

  if ((project.description ?? "").trim() !== "") return true;
  if (project.venuePresetId) return true;
  if (project.eventDate) return true;
  if (project.activeScenarioId) return true;

  // Any name other than the blank default is a deliberate user decision.
  const name = (project.name ?? "").trim();
  if (name && name !== pristine.name) return true;

  if (!areaConfigEqual(project.classroom, pristine.classroom)) return true;
  if (!areaConfigEqual(project.corridor, pristine.corridor)) return true;
  if (!tileConfigEqual(project.tile, pristine.tile)) return true;
  if (!calibrationEqual(project.calibration, pristine.calibration)) return true;
  if (!layersEqual(project.layers, pristine.layers)) return true;
  if (!validationEqual(project.validationSettings, pristine.validationSettings)) return true;

  return false;
}

function areaConfigEqual(a: AreaConfig, b: AreaConfig): boolean {
  return a.id === b.id && a.name === b.name && a.length === b.length
    && a.width === b.width && a.x === b.x && a.z === b.z;
}

function tileConfigEqual(a: TileConfig, b: TileConfig): boolean {
  return a.width === b.width && a.depth === b.depth
    && a.originX === b.originX && a.originZ === b.originZ
    && a.rotationDeg === b.rotationDeg && a.visible === b.visible;
}

function calibrationEqual(a: Calibration, b: Calibration): boolean {
  return a.referenceLength === b.referenceLength
    && (a.note ?? "") === (b.note ?? "")
    && !!a.confirmed?.tile === !!b.confirmed?.tile
    && !!a.confirmed?.door === !!b.confirmed?.door
    && !!a.confirmed?.room === !!b.confirmed?.room;
}

function layersEqual(a: LayerVisibility, b: LayerVisibility): boolean {
  return a.areas === b.areas && a.zones === b.zones && a.objects === b.objects
    && a.tiles === b.tiles && a.routes === b.routes;
}

function validationEqual(a: ValidationSettings, b: ValidationSettings): boolean {
  return a.minAisleWidth === b.minAisleWidth
    && a.doorFrontClearance === b.doorFrontClearance
    && a.matWallClearance === b.matWallClearance
    && a.checkScreenView === b.checkScreenView
    && a.checkZoneRouteIntrusion === b.checkZoneRouteIntrusion;
}

/**
 * Does this plan's geometry still need measuring on site?
 *
 * This used to be `venuePresetId === "venue:tku-e310"` — one hard-coded id.
 * Every other template therefore exported with no 尺寸待現場校正 footer and
 * reported 「檢查通過」, including the outdoor booth, whose every dimension is
 * an estimate read off a photograph. A plan that says 檢查通過 over invented
 * measurements is the exact thing REFERENCE_MAPPING forbids.
 *
 * So it is data now: a template that ships estimates says so by putting a note
 * on `calibration`, and that note is what raises the flag. The E310 id stays as
 * well, because projects saved before templates carried notes have none.
 */
export function venueNeedsCalibration(project: Project): boolean {
  if (project.venuePresetId === "venue:tku-e310") return true;
  return (project.calibration.note ?? "").trim() !== "";
}

/**
 * Which on-site confirmations this venue can actually offer.
 *
 * A door is only a calibration reference if the venue has one. An outdoor
 * booth has no door, so demanding a door measurement would leave it
 * permanently 待校正 with no way to finish — which trains people to ignore
 * the warning, and then it stops working for E310 too.
 */
function calibrationChecks(project: Project): ("tile" | "door" | "room")[] {
  const hasDoor = project.objects.some((o) => o.kind === "door" && !o.hidden);
  return hasDoor ? ["tile", "door", "room"] : ["tile", "room"];
}

export function calibrationComplete(project: Project): boolean {
  if (!venueNeedsCalibration(project)) return true;
  const c = project.calibration.confirmed;
  return calibrationChecks(project).every((k) => c[k] === true);
}

export function calibrationPendingLabels(project: Project): string[] {
  if (!venueNeedsCalibration(project)) return [];
  const c = project.calibration.confirmed;
  const label = { tile: "地磚", door: "門寬", room: "已知距離" } as const;
  return calibrationChecks(project).filter((k) => !c[k]).map((k) => label[k]);
}

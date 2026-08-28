/**
 * Quick Agent intent / tool / response types.
 * LLM may only emit intents + params — never raw project JSON patches.
 */

import type { SemanticAssetType, ServiceRole } from "../core/catalog";

export type OptimizationObjective = "clear-doors" | "separate-checkin-payment" | "reduce-crowding";

export type SpatialTarget =
  | { type: "near-entrance" }
  | { type: "classroom-center" }
  | { type: "beside-selection" }
  | { type: "point"; x: number; z: number };

export type AgentIntent =
  | { type: "create-custom-asset"; sourceImageId?: string; name?: string; semanticHint?: string; dimensions?: { width: number; depth: number; height: number }; serviceRole?: ServiceRole }
  | { type: "place-assets"; assetId: string; count: number; target?: SpatialTarget }
  | { type: "separate-service-flow"; services: ("checkin" | "payment")[] }
  | { type: "simulate"; participants: number; scenarioId?: string }
  | { type: "optimize-layout"; objectives: OptimizationObjective[] }
  | { type: "explain-bottleneck" }
  | { type: "prepare-team-view" }
  // §35 「AI 幫我做一個道具」. The agent proposes a RECIPE — a named prop with
  // a size, a look and, for a game, how many faces and what is on them. It
  // never writes geometry or project JSON; the executor turns the recipe into
  // a PropDefinition through the same builders the Studio uses, into the
  // draft, so the answer arrives as the existing preview → 套用/取消 loop.
  | {
    type: "create-prop";
    name: string;
    /** dice | spinner | cardbox | box | table | screen | sign — a preset to start from. */
    kind?: string;
    dimensions?: { width: number; depth: number; height: number };
    color?: string;
    /** Faces / wedges / cards, when the prop is a game. */
    faces?: { label: string; color?: string; prompt?: string }[];
    interactive?: boolean;
  }
  | { type: "unknown"; raw: string };

export type AgentToolName =
  | "getProjectSummary"
  | "getVenueGeometry"
  | "listAssets"
  | "getSelection"
  | "getZones"
  | "getRoutes"
  | "getValidationIssues"
  | "getSimulationSummary"
  | "createAssetFromCatalog"
  | "createCustomAssetProxy"
  | "createPropFromRecipe"
  | "requestAssetReconstruction"
  | "importAsset"
  | "updateAssetMetadata"
  | "replaceAssetVisual"
  | "placeAsset"
  | "moveAsset"
  | "rotateAsset"
  | "duplicateAsset"
  | "createArray"
  | "updateArray"
  | "createZone"
  | "updateZone"
  | "createRoute"
  | "updateRoute"
  | "createServiceStation"
  | "updateServiceStation"
  | "validateLayout"
  | "measureGap"
  | "simulateScenario"
  | "compareScenarios"
  | "previewAgentChanges"
  | "commitAgentChanges"
  | "rollbackAgentChanges";

export interface AgentToolCall {
  tool: AgentToolName;
  args?: Record<string, unknown>;
}

export interface AgentRequest {
  text: string;
  selectionIds?: string[];
  locale?: string;
}

export interface AgentResponse {
  intents: AgentIntent[];
  toolCalls: AgentToolCall[];
  message: string;
  provider: string;
}

export interface AgentDiffSummary {
  addedObjectIds: string[];
  movedObjectIds: string[];
  removedObjectIds: string[];
  addedCatalogIds: string[];
  /** Prop definitions the draft adds, changes or drops. Without these a prop
   *  recipe was INVISIBLE in the preview table — the user was asked to accept
   *  a change the summary did not mention. */
  addedPropIds: string[];
  changedPropIds: string[];
  removedPropIds: string[];
  notes: string[];
  validationBefore?: { errors: number; warnings: number };
  validationAfter?: { errors: number; warnings: number };
}

export interface AgentActionCard {
  title: string;
  detail: string;
}

export type { SemanticAssetType, ServiceRole };

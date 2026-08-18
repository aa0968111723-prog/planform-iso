/**
 * Quick Agent intent / tool / response types.
 * LLM may only emit intents + params — never raw project JSON patches.
 */

import type { SemanticAssetType, ServiceRole } from "../core/catalog";
import type { OptimizationObjective as EventOptObjective } from "../core/eventOptimization";

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
  | { type: "configure-registration"; participants: number; onsitePayment?: number; prepaid?: number; checkinStaff?: number; paymentStaff?: number }
  | { type: "what-if-staff"; remove?: number }
  | { type: "optimize-event"; objective?: EventOptObjective }
  | { type: "optimize-layout"; objectives: OptimizationObjective[] }
  | { type: "explain-bottleneck" }
  | { type: "prepare-team-view" }
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
  | "readScenario"
  | "readSimulationResult"
  | "createAssetFromCatalog"
  | "createCustomAssetProxy"
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
  | "configureScenario"
  | "splitPaymentFlow"
  | "assignStaff"
  | "validateLayout"
  | "measureGap"
  | "simulateScenario"
  | "compareScenarios"
  | "findBottlenecks"
  | "generateLayoutCandidates"
  | "optimizeEventFlow"
  | "explainImprovement"
  | "focusIssue"
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
  notes: string[];
  validationBefore?: { errors: number; warnings: number };
  validationAfter?: { errors: number; warnings: number };
  simulationBefore?: { finish: number; maxQueue: number; avgWait: number; staff: number };
  simulationAfter?: { finish: number; maxQueue: number; avgWait: number; staff: number };
}

export interface AgentActionCard {
  title: string;
  detail: string;
}

export type { SemanticAssetType, ServiceRole, EventOptObjective };

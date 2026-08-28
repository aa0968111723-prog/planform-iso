/**
 * Quick Agent orchestrator: NL → provider → plan → draft tools → preview.
 *
 * The orchestrator owns three things the provider deliberately does not:
 *
 * 1. **Planning against the draft.** 「把報到桌移到入口右側」 becomes coordinates
 *    only once you can see where the door and the desk are. A provider does not
 *    get the plan document — a cloud one must never get it — so resolution
 *    happens here.
 * 2. **Threading outputs into later steps.** A plan that creates an asset and
 *    then places it cannot know the new id in advance. Steps carry
 *    `<from:toolName>` placeholders and this file substitutes the real value,
 *    aborting the dependent step honestly when the producer failed.
 * 3. **The preview/commit gate.** Every run starts a fresh draft from committed
 *    state; nothing reaches the store until `commit()`.
 */

import type { Store } from "../state/store";
import { ReconstructionQueue } from "../assets/reconstruction";
import { AgentExecutor, type ToolResult } from "./executor";
import type { AgentHost } from "./host";
import { describeParse, type ParsedRequest } from "./intent";
import { planFromRequest, type PlannedStep } from "./planner";
import { createDefaultProvider, type AgentProvider } from "./provider";
import { AgentTransaction } from "./transaction";
import type {
  AgentActionCard,
  AgentDiffSummary,
  AgentRequest,
  AgentResponse,
  AgentToolCall,
} from "./types";

export interface QuickAgentResult {
  response: AgentResponse;
  toolResults: ToolResult[];
  summary: AgentDiffSummary;
  cards: AgentActionCard[];
  previewActive: boolean;
  /** What the sentence was understood to mean, in the user's words. */
  understanding: string[];
  /** Values the agent had to assume. */
  assumptions: string[];
  /** References the sentence made that the plan could not satisfy. */
  unresolved: string[];
  /** The steps that were planned, with the reason for each. */
  plan: { tool: string; because: string }[];
}

const PLACEHOLDER = /^<from:(\w+)>$/;

/** Fields a producing tool can supply to a later step. */
const OUTPUT_KEYS = ["assetId", "objectId", "zoneId", "routeId", "groupId", "propId", "stationId"] as const;

export class QuickAgent {
  readonly tx = new AgentTransaction();
  readonly reconstructionQueue = new ReconstructionQueue();
  private provider: AgentProvider;
  private host?: AgentHost;

  constructor(
    private store: Store,
    provider?: AgentProvider,
    host?: AgentHost,
  ) {
    this.provider = provider ?? createDefaultProvider();
    this.host = host;
  }

  setProvider(provider: AgentProvider): void {
    this.provider = provider;
  }

  setHost(host: AgentHost | undefined): void {
    this.host = host;
  }

  getProviderId(): string {
    return this.provider.id;
  }

  isPreviewActive(): boolean {
    return this.tx.isActive;
  }

  getDraftProject() {
    return this.tx.getDraft();
  }

  async run(request: AgentRequest): Promise<QuickAgentResult> {
    // Always start (or restart) a fresh preview from committed state.
    if (this.tx.isActive) this.tx.rollback();
    const draft = this.tx.start(this.store.getState());

    let response: AgentResponse;
    try {
      response = await this.provider.complete(request);
    } catch (e) {
      response = {
        intents: [{ type: "unknown", raw: request.text }],
        toolCalls: [{ tool: "getProjectSummary", args: {} }],
        message: `AI 暫時無法使用（${e instanceof Error ? e.message : "error"}），改用本地摘要。`,
        provider: "fallback",
      };
    }

    // --- planning ----------------------------------------------------
    let steps: PlannedStep[];
    let unresolved: string[] = [];
    let assumptions = response.assumptions ?? [];
    let understanding: string[] = [];
    let message = response.message;

    const parsed = response.parsed as ParsedRequest | undefined;
    if (parsed && Array.isArray(parsed.intents)) {
      const plan = planFromRequest(parsed, draft);
      steps = plan.steps;
      unresolved = plan.unresolved;
      assumptions = plan.assumptions;
      understanding = describeParse(parsed);
      message = plan.message;
    } else {
      steps = response.toolCalls.map((call) => ({ call, because: "" }));
    }

    // The orchestrator owns commit/rollback/preview; a provider or plan asking
    // for them is ignored rather than obeyed.
    steps = steps.filter(
      (s) => !["commitAgentChanges", "rollbackAgentChanges", "previewAgentChanges"].includes(s.call.tool),
    );

    // --- execution with output threading -----------------------------
    const executor = new AgentExecutor(this.tx, {
      selectionIds: request.selectionIds ?? [],
      reconstructionQueue: this.reconstructionQueue,
      ...(this.host ? { host: this.host } : {}),
    });

    const produced = new Map<string, Record<string, unknown>>();
    const toolResults: ToolResult[] = [];
    for (const step of steps) {
      const resolved = this.substitute(step.call, produced);
      if ("error" in resolved) {
        toolResults.push({ ok: false, tool: step.call.tool, error: resolved.error });
        continue;
      }
      const result = await executor.run(resolved.call);
      toolResults.push(result);
      if (result.ok && result.data && typeof result.data === "object") {
        produced.set(step.call.tool, result.data as Record<string, unknown>);
      }
    }

    const preview = await executor.run({ tool: "previewAgentChanges", args: {} });
    const summary = (preview.data as AgentDiffSummary) ?? this.tx.summarize();

    const failures = toolResults.filter((r) => !r.ok);
    const cards: AgentActionCard[] = [
      ...(message ? [{ title: "AI 說明", detail: message }] : []),
      ...understanding.map((u) => ({ title: "理解", detail: u })),
      ...assumptions.map((a) => ({ title: "假設", detail: a })),
      ...summary.notes.map((n) => ({ title: "變更", detail: n })),
      ...unresolved.map((u) => ({ title: "沒做到", detail: u })),
      ...failures.map((r) => ({ title: "工具失敗", detail: `${r.tool}: ${r.error}` })),
    ];

    return {
      response: { ...response, message },
      toolResults,
      summary,
      cards,
      previewActive: this.tx.isActive,
      understanding,
      assumptions,
      unresolved,
      plan: steps.map((s) => ({ tool: s.call.tool, because: s.because })),
    };
  }

  /**
   * Replace `<from:toolName>` placeholders with a value the named tool actually
   * returned. A dependent step whose producer failed is reported as a failure
   * rather than being run with the literal placeholder — which would either
   * error confusingly or, worse, match nothing and look like a no-op.
   */
  private substitute(
    call: AgentToolCall,
    produced: Map<string, Record<string, unknown>>,
  ): { call: AgentToolCall } | { error: string } {
    if (!call.args) return { call };
    const args: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(call.args)) {
      if (typeof value !== "string") {
        args[key] = value;
        continue;
      }
      const m = PLACEHOLDER.exec(value);
      if (!m) {
        args[key] = value;
        continue;
      }
      const source = produced.get(m[1]);
      if (!source) {
        return { error: `這一步需要 ${m[1]} 的結果，但那一步沒有成功。` };
      }
      const found = OUTPUT_KEYS.map((k) => source[k]).find((v) => typeof v === "string");
      if (found === undefined) {
        return { error: `${m[1]} 沒有回傳可以用在「${key}」的 id。` };
      }
      args[key] = found;
    }
    return { call: { tool: call.tool, args } };
  }

  commit(): AgentDiffSummary {
    return this.tx.commit(this.store);
  }

  rollback(): void {
    this.tx.rollback();
  }
}

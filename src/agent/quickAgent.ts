/**
 * Quick Agent orchestrator: NL → provider intents → draft tools → preview summary.
 */

import type { Store } from "../state/store";
import { ReconstructionQueue } from "../assets/reconstruction";
import { AgentExecutor } from "./executor";
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
  toolResults: { ok: boolean; tool: string; error?: string; data?: unknown }[];
  summary: AgentDiffSummary;
  cards: AgentActionCard[];
  previewActive: boolean;
}

export class QuickAgent {
  readonly tx = new AgentTransaction();
  readonly reconstructionQueue = new ReconstructionQueue();
  private provider: AgentProvider;

  constructor(
    private store: Store,
    provider?: AgentProvider,
  ) {
    this.provider = provider ?? createDefaultProvider();
  }

  setProvider(provider: AgentProvider): void {
    this.provider = provider;
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
    this.tx.start(this.store.getState());

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

    const executor = new AgentExecutor(this.tx, {
      selectionIds: request.selectionIds ?? [],
      reconstructionQueue: this.reconstructionQueue,
    });

    // Drop commit/rollback/preview meta tools from provider — orchestrator owns them.
    const calls: AgentToolCall[] = response.toolCalls.filter(
      (c) => !["commitAgentChanges", "rollbackAgentChanges", "previewAgentChanges"].includes(c.tool),
    );
    const toolResults = await executor.runAll(calls);
    const preview = await executor.run({ tool: "previewAgentChanges", args: {} });
    const summary = (preview.data as AgentDiffSummary) ?? this.tx.summarize();

    const cards: AgentActionCard[] = [
      { title: "AI 說明", detail: response.message },
      ...summary.notes.map((n) => ({ title: "變更", detail: n })),
      ...toolResults
        .filter((r) => !r.ok)
        .map((r) => ({ title: "工具失敗", detail: `${r.tool}: ${r.error}` })),
    ];

    return {
      response,
      toolResults,
      summary,
      cards,
      previewActive: this.tx.isActive,
    };
  }

  commit(): AgentDiffSummary {
    return this.tx.commit(this.store);
  }

  rollback(): void {
    this.tx.rollback();
  }
}

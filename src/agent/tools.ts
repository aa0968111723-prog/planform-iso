/**
 * Allowlisted agent tools. Unknown tools are rejected by the executor.
 *
 * The list is DERIVED from `toolSchema.ts` rather than hand-copied. Two
 * hand-maintained lists is how a tool ends up callable but unvalidated, or
 * declared but unreachable — `toolNames()` makes that impossible by
 * construction.
 */

import { toolNames } from "./toolSchema";
import type { AgentToolName } from "./types";

export const AGENT_TOOL_ALLOWLIST: ReadonlySet<AgentToolName> = new Set(toolNames());

export function isAllowedTool(name: string): name is AgentToolName {
  return AGENT_TOOL_ALLOWLIST.has(name as AgentToolName);
}

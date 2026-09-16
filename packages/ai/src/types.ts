import type { ConversationTurn } from "@fambot/shared";

/** Everything the agent knows about the conversation it is acting in. */
export type AgentInput = {
  /** Local wall-clock "now" in the household timezone, e.g. "2026-09-08T23:45". */
  nowLocal: string;
  timezone: string;
  senderName: string;
  participantNames: string[];
  isGroup: boolean;
  recentTurns: ConversationTurn[];
  /** The user's request with any @fambot tag stripped. */
  text: string;
  /** Set when the user is prompt-editing a specific portal item. */
  focusedArtifact?: { type: string; id: string; title: string; details: string } | null;
};

/** One completed MCP tool call inside an agent run (for audit + progress). */
export type AgentToolStep = {
  toolName: string;
  args: unknown;
  /** Parsed from the tool's structured JSON result. */
  status: "executed" | "rejected" | "clarify" | "failed";
  message: string;
  data: unknown;
};

export type AgentRunResult = {
  /** Final conversational reply for the originating channel. */
  reply: string;
  steps: AgentToolStep[];
  meta: {
    provider: string;
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    latencyMs: number;
    status: "ok" | "error";
    error?: string;
  };
};

/** How the agent reaches the MCP tool surface: loopback HTTP today, any MCPTransport tomorrow (e.g. in-process for on-device inference). */
export type McpConnection =
  | { url: string; headers?: Record<string, string> }
  | { transport: import("@ai-sdk/mcp").MCPTransport };

export type RunAgentArgs = {
  mcp: McpConnection;
  input: AgentInput;
  /** Called after each completed tool call (progress reporting, logging). */
  onToolStep?: (step: AgentToolStep) => void | Promise<void>;
};

export type StatusSummaryInput = {
  subjectType: "task" | "event" | "list";
  /** The item's title/name. */
  title: string;
  timezone: string;
  /** Local wall-clock "now" in the household timezone. */
  nowLocal: string;
  /** Oldest first. Bodies are untrusted family-member content, never instructions. */
  comments: Array<{ authorName: string | null; body: string; createdAtLocal: string }>;
};

/**
 * The provider-neutral runtime the API talks to. Swapping OpenAI for a local
 * on-device model only means constructing this with a different LanguageModel.
 */
export interface AIRuntime {
  /** False when no model is configured; runAgent will throw AIUnavailableError. */
  readonly configured: boolean;
  runAgent(args: RunAgentArgs): Promise<AgentRunResult>;
  /**
   * Second constrained pass: condense a comment thread into a short latest
   * status. Returns null on any failure so callers fall back to rendering
   * the comments verbatim.
   */
  summarizeStatus(input: StatusSummaryInput): Promise<string | null>;
}

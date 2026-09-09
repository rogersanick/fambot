import type { ConversationTurn, ProposedAction } from "@fambot/shared";

export type InterpretationInput = {
  /** Local wall-clock "now" in the household timezone, e.g. "2026-09-08T23:45". */
  nowLocal: string;
  timezone: string;
  senderName: string;
  participantNames: string[];
  isGroup: boolean;
  recentTurns: ConversationTurn[];
  /** The user's request with any @fambot tag stripped. */
  text: string;
};

export type InterpretationResult = {
  actions: ProposedAction[];
  meta: {
    provider: string;
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    latencyMs: number;
    /** "ok" | "invalid_output" (fell back to clarify) | "error" */
    status: "ok" | "invalid_output" | "error";
    error?: string;
  };
};

export interface AIProvider {
  interpret(input: InterpretationInput): Promise<InterpretationResult>;
}

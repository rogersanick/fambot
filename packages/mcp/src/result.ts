/**
 * Structured result every Fambot MCP tool returns (serialized as JSON text in
 * the tool result content). Mirrors the domain executor's SingleActionResult
 * so agents can branch on `status` without parsing prose.
 */
export type ToolResult<T = unknown> = {
  status: "executed" | "rejected" | "clarify" | "failed";
  /** User-safe copy describing what happened (never internal errors). */
  message: string;
  /** Typed payload: ids, counts, rows. */
  data: T;
};

export function executed<T>(message: string, data: T): ToolResult<T> {
  return { status: "executed", message, data };
}

export function clarify(message: string): ToolResult<null> {
  return { status: "clarify", message, data: null };
}

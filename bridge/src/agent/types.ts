export interface AgentRequest {
  system: string;
  user: string;
}

/** The one pluggable seam: prompt in, iMessage-ready reply text out. */
export type AgentRunner = (request: AgentRequest) => Promise<string>;

/** MCP tool surface as the openai-loop adapter consumes it (test seam). */
export interface ToolPort {
  list(): Promise<ToolSpec[]>;
  call(name: string, args: Record<string, unknown>): Promise<string>;
  close(): Promise<void>;
}

export interface ToolSpec {
  name: string;
  description?: string;
  inputSchema: unknown;
}

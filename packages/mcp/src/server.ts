import { z } from "zod";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { and, eq } from "drizzle-orm";
import { mcpToolCalls } from "@fambot/database";
import type { ExecutionContext } from "@fambot/domain";
import { allTools, toolByName, type ToolDefinition } from "./tools";
import type { ToolResult } from "./result";

const IDEMPOTENCY_DESCRIPTION =
  "Optional client-chosen unique key. Retrying with the same key returns the original result instead of repeating the mutation.";

/** JSON Schema for tools/list; mutating tools gain an optional idempotency_key. */
export function toolInputJsonSchema(tool: ToolDefinition): Record<string, unknown> {
  const schema = z.toJSONSchema(tool.inputSchema, { target: "draft-7", io: "input" }) as Record<
    string,
    unknown
  >;
  if (tool.mutating) {
    const properties = (schema.properties ?? {}) as Record<string, unknown>;
    properties.idempotency_key = { type: "string", description: IDEMPOTENCY_DESCRIPTION };
    schema.properties = properties;
  }
  delete schema.$schema;
  return schema;
}

/**
 * Validate, replay-protect, and run one tool call. Never throws — every
 * failure becomes a structured ToolResult the model can read.
 */
export async function runTool(
  ctx: ExecutionContext,
  tool: ToolDefinition,
  rawArgs: unknown
): Promise<ToolResult> {
  const { idempotency_key: rawKey, ...rest } = (rawArgs ?? {}) as Record<string, unknown>;
  const parsed = tool.inputSchema.safeParse(rest);
  if (!parsed.success) {
    return {
      status: "failed",
      message: `Invalid arguments for ${tool.name}: ${z.prettifyError(parsed.error)}`,
      data: null,
    };
  }

  const idempotencyKey = tool.mutating && typeof rawKey === "string" && rawKey ? rawKey : null;
  if (idempotencyKey) {
    const [existing] = await ctx.db
      .select({ resultJson: mcpToolCalls.resultJson })
      .from(mcpToolCalls)
      .where(
        and(
          eq(mcpToolCalls.householdId, ctx.householdId),
          eq(mcpToolCalls.idempotencyKey, idempotencyKey)
        )
      )
      .limit(1);
    if (existing) return existing.resultJson as ToolResult;
  }

  const result = await tool.handler(ctx, parsed.data);

  if (idempotencyKey && result.status === "executed") {
    await ctx.db
      .insert(mcpToolCalls)
      .values({
        householdId: ctx.householdId,
        idempotencyKey,
        toolName: tool.name,
        resultJson: result,
      })
      .onConflictDoNothing();
  }
  return result;
}

/**
 * Stateless per-request MCP server bound to one authenticated household
 * context. Create a fresh instance per HTTP request; it holds no session
 * state beyond the ExecutionContext it closes over.
 */
export function createFambotMcpServer(ctx: ExecutionContext): Server {
  const server = new Server(
    { name: "fambot", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: toolInputJsonSchema(tool),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = toolByName.get(request.params.name);
    const result: ToolResult = tool
      ? await runTool(ctx, tool, request.params.arguments ?? {})
      : { status: "failed", message: `Unknown tool: ${request.params.name}`, data: null };
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  return server;
}

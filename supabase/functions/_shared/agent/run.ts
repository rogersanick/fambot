import type { Sql } from "../db.ts";
import type { AgentContext } from "./types.ts";
import { proposeAction } from "./llm.ts";
import { validate } from "./validator.ts";
import {
  enqueueReply, execute, executeClarification, resolveOpenClarification,
} from "./executor.ts";
import { composeError, composeRefusal } from "./composer.ts";

/**
 * The agent pipeline for an active household:
 * context (already assembled) → LLM proposal → deterministic validation →
 * transactional execution → composed reply. Any failure produces a single
 * apologetic line and zero mutations.
 */
export async function runAgent(sql: Sql, ctx: AgentContext): Promise<void> {
  const proposal = await proposeAction(sql, ctx);

  if ("error" in proposal) {
    console.error(`[agent] LLM failure for ${ctx.inboundMessageId}: ${proposal.error}`);
    await enqueueReply(
      sql,
      ctx,
      `I couldn't process that just now — mind trying again in a minute?\n${appHelpLink()}`,
      "system",
      `llm-error:${ctx.inboundMessageId}`,
    );
    return;
  }

  const result = validate(proposal.output, ctx);

  await sql`
    update bot_runs
       set validation_result = ${sql.json({ kind: result.kind } as never)},
           state = ${result.kind === "error" ? "validation_failed" : "succeeded"}
     where id = ${proposal.botRunId}
  `;

  switch (result.kind) {
    case "execute": {
      await execute(sql, ctx, result.action);
      // Answering the open question resolves it; unrelated commands leave it open.
      if (
        proposal.output.intent === "ANSWER_CLARIFICATION" ||
        result.action.type === "cancel_clarification"
      ) {
        await resolveOpenClarification(sql, ctx.household.id);
      }
      break;
    }
    case "clarify":
      await executeClarification(sql, ctx, result.missingField, result.question, result.draft);
      break;
    case "error":
      await enqueueReply(sql, ctx, composeError(ctx, result.message), "system");
      break;
    case "refuse":
      await enqueueReply(sql, ctx, composeRefusal(result.message), "system");
      break;
  }
}

function appHelpLink(): string {
  return `${(Deno.env.get("APP_BASE_URL") ?? "http://localhost:3000").replace(/\/$/, "")}/help`;
}

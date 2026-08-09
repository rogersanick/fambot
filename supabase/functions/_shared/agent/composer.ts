import type { AgentContext, EventRow, MemberRow, TaskRow } from "./types.ts";
import { formatWhen } from "./time.ts";
import { links } from "./deeplink.ts";

/**
 * Interaction-style rules: warm, brief, competent. ✓ for confirmations,
 * • for bullets, nothing else. At most 3 short lines plus the link line.
 * Exactly one link per message, always the last line.
 */

export function memberName(members: MemberRow[], id: string | null): string | null {
  if (!id) return null;
  const m = members.find((x) => x.id === id);
  return m ? (m.display_name?.split(/\s+/)[0] ?? m.normalized_handle) : null;
}

export function composeTaskConfirmation(
  ctx: AgentContext,
  verb: "Added" | "Updated" | "Completed" | "Deleted",
  task: { title: string; short_code: string; assignee_member_id?: string | null; due_at?: string | Date | null },
  disclosedDefault: string | null,
): string {
  const tz = ctx.household.timezone ?? "UTC";
  const lines = [`✓ ${verb} "${task.title}"`];

  if (verb === "Added" || verb === "Updated") {
    const details: string[] = [];
    const who = memberName(ctx.members, task.assignee_member_id ?? null);
    if (who) details.push(`Assigned: ${who}`);
    if (task.due_at) {
      const when = formatWhen(new Date(task.due_at), tz, ctx.now);
      details.push(`Due: ${when}${disclosedDefault ? ` (${disclosedDefault})` : ""}`);
    }
    if (details.length > 0) lines.push(details.join(" · "));
  }

  lines.push(links.task(ctx.household.slug, task.short_code));
  return lines.join("\n");
}

export function composeEventConfirmation(
  ctx: AgentContext,
  verb: "Added" | "Updated" | "Cancelled",
  event: { title: string; starts_at: string | Date; location?: string | null },
): string {
  const tz = ctx.household.timezone ?? "UTC";
  const starts = new Date(event.starts_at);
  const lines = [`✓ ${verb} "${event.title}" — ${formatWhen(starts, tz, ctx.now)}`];
  if (event.location) lines.push(`Where: ${event.location}`);
  lines.push(links.calendarDay(ctx.household.slug, starts, tz));
  return lines.join("\n");
}

export function composeTaskList(ctx: AgentContext): string {
  const tz = ctx.household.timezone ?? "UTC";
  const open = ctx.openTasks;
  if (open.length === 0) {
    return `No open tasks — nice work.\n${links.today(ctx.household.slug)}`;
  }
  const shown = open.slice(0, 10);
  const bullets = shown.map((t: TaskRow) => {
    const who = memberName(ctx.members, t.assignee_member_id);
    const when = t.due_at ? ` — ${formatWhen(new Date(t.due_at), tz, ctx.now)}` : "";
    return `• ${who ? `${who}: ` : ""}${t.title}${when}`;
  });
  const more = open.length > shown.length ? [`…and ${open.length - shown.length} more — see the rest below.`] : [];
  return [`Open tasks:`, ...bullets, ...more, links.today(ctx.household.slug)].join("\n");
}

export function composeEventList(ctx: AgentContext): string {
  const tz = ctx.household.timezone ?? "UTC";
  const events = ctx.upcomingEvents;
  if (events.length === 0) {
    return `Nothing on the calendar for the next two weeks.\n${links.calendar(ctx.household.slug)}`;
  }
  const shown = events.slice(0, 10);
  const bullets = shown.map((e: EventRow) => `• ${e.title} — ${formatWhen(new Date(e.starts_at), tz, ctx.now)}`);
  const more = events.length > shown.length ? [`…and ${events.length - shown.length} more — see the rest below.`] : [];
  return [`Coming up:`, ...bullets, ...more, links.calendar(ctx.household.slug)].join("\n");
}

/** Every question ends with a tag reminder — answers must tag the bot. */
export function composeClarification(ctx: AgentContext, question: string): string {
  const q = question.trim().replace(/\s*Reply with @\w+\.?$/i, "");
  const tag = `@${ctx.household.invocation_name}`;
  return `${q} Reply with ${tag}.\n${links.today(ctx.household.slug)}`;
}

export function composeError(ctx: AgentContext, message: string): string {
  return `${message}\n${links.today(ctx.household.slug)}`;
}

export function composeRefusal(message: string): string {
  return `${message}\n${links.help()}`;
}

export function composeRename(ctx: AgentContext, newName: string): string {
  const pretty = newName.charAt(0).toUpperCase() + newName.slice(1);
  return `✓ You can call me ${pretty} now (fambot also works)\n${links.settings(ctx.household.slug)}`;
}

export function composeHelp(ctx: AgentContext | null): string {
  const name = ctx?.household.invocation_name ?? "fambot";
  return [
    `Tag @${name} to manage this group's shared tasks and events.`,
    `• "@${name} remind Jess to buy cucumbers this evening"`,
    `• "@${name} add dentist appointment Friday 3pm" · "@${name} list"`,
    links.help(),
  ].join("\n");
}

import type {
  AgentContext, EventRow, MemberRow, StructuredOutput, TaskRow, ValidationResult,
} from "./types.ts";
import { applyNamedWindow } from "./time.ts";

const SELF_WORDS = new Set(["me", "i", "my", "myself", "mine"]);
const HOUSEHOLD_WORDS = new Set(["we", "us", "our", "ours", "everyone", "anyone", "household", "family", "all of us"]);
const BULK_WORDS = new Set(["all", "everything", "all tasks", "every task", "all of them"]);

type AssigneeResolution =
  | { kind: "member"; memberId: string | null }
  | { kind: "clarify"; question: string; missingField: string };

/**
 * The LLM proposes; this disposes. Model-provided IDs are never trusted —
 * every reference is resolved here against household-scoped rows.
 */
export function validate(proposal: StructuredOutput, ctx: AgentContext): ValidationResult {
  switch (proposal.intent) {
    case "UNKNOWN":
      return {
        kind: "refuse",
        message: "I help this group with shared tasks, events, and reminders — that one's outside what I can do.",
      };
    case "HELP":
      return { kind: "execute", action: { type: "help" } };
    case "CANCEL_CLARIFICATION":
      return ctx.openClarification
        ? { kind: "execute", action: { type: "cancel_clarification" } }
        : { kind: "error", message: "There's no open question to cancel." };
    case "ANSWER_CLARIFICATION":
      return validateClarificationAnswer(proposal, ctx);
    case "LIST_TASKS":
      return { kind: "execute", action: { type: "list_tasks" } };
    case "LIST_EVENTS":
      return { kind: "execute", action: { type: "list_events" } };
    case "RENAME_BOT":
      return validateRename(proposal, ctx);
    case "CREATE_TASK":
      return validateCreateTask(proposal, ctx);
    case "CREATE_EVENT":
      return validateCreateEvent(proposal, ctx);
    case "COMPLETE_TASK":
      return withTask(proposal, ctx, (task) => ({ kind: "execute", action: { type: "complete_task", task } }));
    case "DELETE_TASK":
      return validateDeleteTask(proposal, ctx);
    case "DELETE_EVENT":
      return withEvent(proposal, ctx, (event) => ({ kind: "execute", action: { type: "delete_event", event } }));
    case "UPDATE_TASK":
      return validateUpdateTask(proposal, ctx);
    case "UPDATE_EVENT":
      return validateUpdateEvent(proposal, ctx);
    // SETUP/STOP/LINK are handled deterministically before the LLM; if the
    // model proposes them anyway, route to the safe equivalents.
    case "SETUP":
    case "STOP":
    case "LINK":
      return { kind: "execute", action: { type: "help" } };
    default:
      return { kind: "refuse", message: "I didn't understand that." };
  }
}

// If the model itself flagged missing fields, honor that as a clarification.
function modelClarification(proposal: StructuredOutput): ValidationResult | null {
  if (proposal.clarification_question && proposal.missing_fields.length > 0) {
    return {
      kind: "clarify",
      missingField: proposal.missing_fields[0] ?? "detail",
      question: proposal.clarification_question,
      draft: proposal,
    };
  }
  return null;
}

function resolveAssignee(reference: string | null, ctx: AgentContext): AssigneeResolution {
  if (!reference) return { kind: "member", memberId: null };
  const ref = reference.trim().toLowerCase();

  if (SELF_WORDS.has(ref)) return { kind: "member", memberId: ctx.sender.id };
  if (HOUSEHOLD_WORDS.has(ref)) return { kind: "member", memberId: null };

  if (ref === "you") {
    const others = ctx.members.filter((m) => m.id !== ctx.sender.id);
    if (others.length === 1) return { kind: "member", memberId: others[0].id };
    return {
      kind: "clarify",
      question: `Who do you mean by "you"?`,
      missingField: "assignee",
    };
  }

  const matches = ctx.members.filter((m) => memberMatches(m, ref));
  if (matches.length === 1) return { kind: "member", memberId: matches[0].id };
  if (matches.length > 1) {
    return {
      kind: "clarify",
      question: `I know more than one "${reference}" — which one do you mean?`,
      missingField: "assignee",
    };
  }
  return {
    kind: "clarify",
    question: `I don't know "${reference}" yet — who should this be assigned to?`,
    missingField: "assignee",
  };
}

function memberMatches(m: MemberRow, ref: string): boolean {
  if (m.display_name && m.display_name.toLowerCase() === ref) return true;
  if (m.display_name && m.display_name.toLowerCase().split(/\s+/)[0] === ref) return true;
  if (m.aliases.some((a) => a.toLowerCase() === ref)) return true;
  if (m.normalized_handle.toLowerCase() === ref) return true;
  return false;
}

interface ResolvedDue {
  date: Date | null;
  disclosure: string | null;
}

function resolveDue(proposal: StructuredOutput, ctx: AgentContext): ResolvedDue | { error: string } {
  if (!proposal.proposed_due_at) return { date: null, disclosure: null };
  const parsed = new Date(proposal.proposed_due_at);
  if (isNaN(parsed.getTime())) return { error: "bad_date" };

  const tz = ctx.household.timezone ?? "UTC";
  const snapped = applyNamedWindow(proposal.due_expression, parsed, tz, {
    morning: ctx.household.morning_default,
    afternoon: ctx.household.afternoon_default,
    evening: ctx.household.evening_default,
  });
  const date = snapped?.date ?? parsed;

  // Implausibly past (over an hour ago) → ask instead of guessing.
  if (date.getTime() < ctx.now.getTime() - 60 * 60 * 1000) return { error: "past_date" };
  // Implausibly far out.
  if (date.getTime() > ctx.now.getTime() + 2 * 365 * 24 * 3600 * 1000) return { error: "far_date" };

  return { date, disclosure: snapped?.disclosure ?? null };
}

function validateCreateTask(proposal: StructuredOutput, ctx: AgentContext): ValidationResult {
  const clarify = modelClarification(proposal);
  if (clarify) return clarify;

  if (!proposal.title) {
    return { kind: "clarify", missingField: "title", question: "What should the task say?", draft: proposal };
  }

  const assignee = resolveAssignee(proposal.assignee_reference, ctx);
  if (assignee.kind === "clarify") {
    return { kind: "clarify", missingField: assignee.missingField, question: assignee.question, draft: proposal };
  }

  const due = resolveDue(proposal, ctx);
  if ("error" in due) {
    return {
      kind: "clarify",
      missingField: "due_time",
      question:
        due.error === "past_date"
          ? `"${proposal.due_expression ?? proposal.proposed_due_at}" looks like it's in the past — when should this be due?`
          : `I couldn't make sense of that time — when should this be due?`,
      draft: { ...proposal, proposed_due_at: null },
    };
  }

  return {
    kind: "execute",
    action: {
      type: "create_task",
      title: proposal.title,
      assigneeMemberId: assignee.memberId,
      dueAt: due.date,
      disclosedDefault: due.disclosure,
    },
  };
}

function validateCreateEvent(proposal: StructuredOutput, ctx: AgentContext): ValidationResult {
  const clarify = modelClarification(proposal);
  if (clarify) return clarify;

  if (!proposal.title) {
    return { kind: "clarify", missingField: "title", question: "What's the event called?", draft: proposal };
  }
  if (!proposal.event_start) {
    return { kind: "clarify", missingField: "event_start", question: `When is "${proposal.title}"?`, draft: proposal };
  }

  const start = new Date(proposal.event_start);
  if (isNaN(start.getTime())) {
    return { kind: "clarify", missingField: "event_start", question: `I couldn't read that time — when is "${proposal.title}"?`, draft: { ...proposal, event_start: null } };
  }
  let end: Date | null = null;
  if (proposal.event_end) {
    end = new Date(proposal.event_end);
    if (isNaN(end.getTime())) end = null;
  }
  if (end && end <= start) {
    return { kind: "clarify", missingField: "event_end", question: "That end time is before the start — when does it end?", draft: { ...proposal, event_end: null } };
  }
  if (start.getTime() < ctx.now.getTime() - 60 * 60 * 1000) {
    return { kind: "clarify", missingField: "event_start", question: `That start time looks past — when is "${proposal.title}"?`, draft: { ...proposal, event_start: null } };
  }

  return {
    kind: "execute",
    action: { type: "create_event", title: proposal.title, startsAt: start, endsAt: end, location: proposal.event_location },
  };
}

function resolveTask(reference: string | null, ctx: AgentContext): TaskRow[] {
  if (!reference) return [];
  const ref = reference.trim().toLowerCase();
  const byCode = ctx.openTasks.filter((t) => t.short_code.toLowerCase() === ref);
  if (byCode.length === 1) return byCode;
  const exact = ctx.openTasks.filter((t) => t.title.toLowerCase() === ref);
  if (exact.length > 0) return exact;
  return ctx.openTasks.filter((t) => t.title.toLowerCase().includes(ref));
}

function withTask(
  proposal: StructuredOutput,
  ctx: AgentContext,
  make: (task: TaskRow) => ValidationResult,
): ValidationResult {
  const clarify = modelClarification(proposal);
  if (clarify) return clarify;

  const matches = resolveTask(proposal.target_reference, ctx);
  if (matches.length === 1) return make(matches[0]);
  if (matches.length === 0) {
    return {
      kind: "error",
      message: `I couldn't find a task matching "${proposal.target_reference ?? proposal.title ?? "that"}". Try @${ctx.household.invocation_name} list.`,
    };
  }
  return {
    kind: "clarify",
    missingField: "target",
    question: `Which one: ${matches.slice(0, 4).map((t) => `"${t.title}"`).join(", ")}?`,
    draft: proposal,
  };
}

function resolveEvent(reference: string | null, ctx: AgentContext): EventRow[] {
  if (!reference) return [];
  const ref = reference.trim().toLowerCase();
  const byCode = ctx.upcomingEvents.filter((e) => e.short_code.toLowerCase() === ref);
  if (byCode.length === 1) return byCode;
  const exact = ctx.upcomingEvents.filter((e) => e.title.toLowerCase() === ref);
  if (exact.length > 0) return exact;
  return ctx.upcomingEvents.filter((e) => e.title.toLowerCase().includes(ref));
}

function withEvent(
  proposal: StructuredOutput,
  ctx: AgentContext,
  make: (event: EventRow) => ValidationResult,
): ValidationResult {
  const clarify = modelClarification(proposal);
  if (clarify) return clarify;

  const matches = resolveEvent(proposal.target_reference, ctx);
  if (matches.length === 1) return make(matches[0]);
  if (matches.length === 0) {
    return {
      kind: "error",
      message: `I couldn't find an event matching "${proposal.target_reference ?? proposal.title ?? "that"}".`,
    };
  }
  return {
    kind: "clarify",
    missingField: "target",
    question: `Which event: ${matches.slice(0, 4).map((e) => `"${e.title}"`).join(", ")}?`,
    draft: proposal,
  };
}

function validateDeleteTask(proposal: StructuredOutput, ctx: AgentContext): ValidationResult {
  const ref = proposal.target_reference?.trim().toLowerCase() ?? "";
  if (BULK_WORDS.has(ref)) {
    const count = ctx.openTasks.length;
    if (count === 0) return { kind: "error", message: "There are no open tasks to delete." };
    // Bulk deletions require an explicit confirmation round-trip.
    return {
      kind: "clarify",
      missingField: "confirm_bulk_delete",
      question: `Delete all ${count} open tasks? Reply yes or no.`,
      draft: proposal,
    };
  }
  return withTask(proposal, ctx, (task) => ({ kind: "execute", action: { type: "delete_task", task } }));
}

function validateUpdateTask(proposal: StructuredOutput, ctx: AgentContext): ValidationResult {
  return withTask(proposal, ctx, (task) => {
    let assigneeMemberId: string | null | undefined = undefined;
    if (proposal.assignee_reference) {
      const res = resolveAssignee(proposal.assignee_reference, ctx);
      if (res.kind === "clarify") {
        return { kind: "clarify", missingField: res.missingField, question: res.question, draft: proposal };
      }
      assigneeMemberId = res.memberId;
    }

    let dueAt: Date | null | undefined = undefined;
    let disclosure: string | null = null;
    if (proposal.proposed_due_at) {
      const due = resolveDue(proposal, ctx);
      if ("error" in due) {
        return {
          kind: "clarify", missingField: "due_time",
          question: "I couldn't make sense of that time — when should it be due?",
          draft: { ...proposal, proposed_due_at: null },
        };
      }
      dueAt = due.date;
      disclosure = due.disclosure;
    }

    const title = proposal.title && proposal.title.toLowerCase() !== task.title.toLowerCase() ? proposal.title : null;
    if (title === null && assigneeMemberId === undefined && dueAt === undefined) {
      return { kind: "error", message: `Nothing to change on "${task.title}".` };
    }
    return {
      kind: "execute",
      action: { type: "update_task", task, title, assigneeMemberId, dueAt, disclosedDefault: disclosure },
    };
  });
}

function validateUpdateEvent(proposal: StructuredOutput, ctx: AgentContext): ValidationResult {
  return withEvent(proposal, ctx, (event) => {
    let startsAt: Date | undefined = undefined;
    if (proposal.event_start) {
      const d = new Date(proposal.event_start);
      if (isNaN(d.getTime())) {
        return { kind: "clarify", missingField: "event_start", question: "I couldn't read that time — when should it start?", draft: { ...proposal, event_start: null } };
      }
      startsAt = d;
    }
    let endsAt: Date | null | undefined = undefined;
    if (proposal.event_end) {
      const d = new Date(proposal.event_end);
      if (!isNaN(d.getTime())) endsAt = d;
    }
    const effectiveStart = startsAt ?? new Date(event.starts_at);
    if (endsAt && endsAt <= effectiveStart) {
      return { kind: "clarify", missingField: "event_end", question: "That end time is before the start — when does it end?", draft: { ...proposal, event_end: null } };
    }
    const title = proposal.title && proposal.title.toLowerCase() !== event.title.toLowerCase() ? proposal.title : null;
    const location = proposal.event_location ?? undefined;
    if (title === null && startsAt === undefined && endsAt === undefined && location === undefined) {
      return { kind: "error", message: `Nothing to change on "${event.title}".` };
    }
    return { kind: "execute", action: { type: "update_event", event, title, startsAt, endsAt, location } };
  });
}

function validateRename(proposal: StructuredOutput, ctx: AgentContext): ValidationResult {
  const name = proposal.new_bot_name?.trim() ?? "";
  if (!/^[a-zA-Z]{2,20}$/.test(name)) {
    return {
      kind: "clarify",
      missingField: "bot_name",
      question: "I need a single word of 2-20 letters — what should I be called?",
      draft: proposal,
    };
  }
  const lower = name.toLowerCase();
  const collision = ctx.members.some(
    (m) =>
      m.display_name?.toLowerCase() === lower ||
      m.display_name?.toLowerCase().split(/\s+/)[0] === lower ||
      m.aliases.some((a) => a.toLowerCase() === lower),
  );
  if (collision) {
    return {
      kind: "clarify",
      missingField: "bot_name",
      question: `"${name}" is already someone in this household — pick a different name for me?`,
      draft: { ...proposal, new_bot_name: null },
    };
  }
  return { kind: "execute", action: { type: "rename_bot", newName: lower } };
}

/**
 * Merge the answer into the stored draft and re-validate. If the merged
 * proposal is still ambiguous, a fresh clarification supersedes the old one.
 */
function validateClarificationAnswer(proposal: StructuredOutput, ctx: AgentContext): ValidationResult {
  const open = ctx.openClarification;
  if (!open) {
    // No open question: treat the model's parse as a normal proposal if it
    // carries enough signal, otherwise ask what they mean.
    return { kind: "error", message: "There's no open question right now — tell me the full request." };
  }

  const draft = open.draft_action;

  if (open.missing_field === "confirm_bulk_delete") {
    const answer = (proposal.clarification_answer_value ?? ctx.messageText).toLowerCase();
    if (/\byes\b|\byep\b|\bconfirm\b|\bdo it\b/.test(answer)) {
      return { kind: "execute", action: { type: "delete_all_tasks", count: ctx.openTasks.length } };
    }
    return { kind: "execute", action: { type: "cancel_clarification" } };
  }

  // Overlay any non-null fields the answering turn provided onto the draft.
  const merged: StructuredOutput = {
    ...draft,
    title: proposal.title ?? draft.title,
    assignee_reference: proposal.assignee_reference ?? draft.assignee_reference,
    due_expression: proposal.due_expression ?? draft.due_expression,
    proposed_due_at: proposal.proposed_due_at ?? draft.proposed_due_at,
    event_start: proposal.event_start ?? draft.event_start,
    event_end: proposal.event_end ?? draft.event_end,
    event_location: proposal.event_location ?? draft.event_location,
    target_reference: proposal.target_reference ?? draft.target_reference,
    new_bot_name: proposal.new_bot_name ?? draft.new_bot_name,
    missing_fields: [],
    clarification_question: null,
    clarification_answer_value: null,
  };

  // Free-text answers for specific fields.
  const answer = proposal.clarification_answer_value;
  if (answer && open.missing_field === "title" && !proposal.title) merged.title = answer;
  if (answer && open.missing_field === "assignee" && !proposal.assignee_reference) merged.assignee_reference = answer;

  return validate(merged, ctx);
}

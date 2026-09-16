import type {
  EventItem,
  HouseholdInvite,
  Identity,
  Member,
  Reminder,
  Task,
  TaskSeries,
} from "@/lib/api";
import { describeRRule } from "@/lib/recurrence";
import type { ArtifactType } from "@fambot/shared";

/** Row shapes the ported UI components render (kept from the old portal). */

export type MemberRow = {
  id: string;
  display_name: string;
  role: string;
  user_id: string | null;
  invite: HouseholdInvite | null;
  /** SMS phone (E.164) — the default notification address. */
  phone: string | null;
  /** Optional iMessage handle (number or Apple ID email), managed separately. */
  handle: string | null;
};

export type TaskRow = {
  id: string;
  title: string;
  status: string;
  due_at: string | null;
  completed_at: string | null;
  event_id: string | null;
  assignee: { display_name: string } | null;
  series_id: string | null;
  /** Human recurrence label ("every week on Sun"), null for one-off tasks. */
  recurrence: string | null;
};

export type ChecklistItemRow = {
  id: string;
  body: string;
  completed_at: string | null;
  sort_order: number;
};

export type ListRow = {
  id: string;
  name: string;
  task_id: string | null;
  event_id: string | null;
  items: ChecklistItemRow[];
};

export type EventRow = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  /** Event description/body. Reminders are associated objects, not this text. */
  notes: string | null;
  /** Human recurrence label, null for one-off events. */
  recurrence: string | null;
};

export type ReminderRow = {
  id: string;
  message: string;
  fire_at: string;
  status: string; // pending | sent | cancelled
  recurring: boolean;
  until_completed: boolean;
  parent: { type: "task" | "event"; id: string; title: string } | null;
};

/** Event pre-localized to the household timezone for the client calendar. */
export type CalendarEvent = {
  id: string;
  title: string;
  /** YYYY-MM-DD in the household timezone. */
  day: string;
  time: string;
  location: string | null;
  /** Event description/body. */
  notes: string | null;
  /** Set for occurrences of a recurring series (id = the series id). */
  recurrence: string | null;
  links?: Array<{ type: ArtifactType; id: string; title: string; when?: string }>;
};

// --- adapters: API rows -> UI rows ---------------------------------------------

export function toMemberRows(
  members: Member[],
  identities: Identity[],
  invites: HouseholdInvite[] = []
): MemberRow[] {
  const handleOf = new Map<string, string>();
  const phoneOf = new Map<string, string>();
  const inviteOf = new Map(invites.map((invite) => [invite.memberId, invite]));
  for (const i of identities) {
    if (i.type === "imessage") handleOf.set(i.memberId, i.value);
    if (i.type === "phone") phoneOf.set(i.memberId, i.value);
  }
  return members.map((m) => ({
    id: m.id,
    display_name: m.displayName,
    role: m.role,
    user_id: m.userId,
    invite: inviteOf.get(m.id) ?? null,
    phone: phoneOf.get(m.id) ?? null,
    handle: handleOf.get(m.id) ?? null,
  }));
}

export function toTaskRows(tasks: Task[], members: Member[], series: TaskSeries[] = []): TaskRow[] {
  const nameOf = new Map(members.map((m) => [m.id, m.displayName]));
  const seriesById = new Map(series.map((s) => [s.id, s]));
  return tasks.map((t) => {
    const s = t.seriesId ? seriesById.get(t.seriesId) : undefined;
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      due_at: t.dueAt,
      completed_at: t.completedAt,
      event_id: t.eventId,
      assignee: t.assigneeMemberId ? { display_name: nameOf.get(t.assigneeMemberId) ?? "?" } : null,
      series_id: t.seriesId,
      recurrence: s ? describeRRule(s.rrule) : t.rrule ? describeRRule(t.rrule) : null,
    };
  });
}

export function toEventRows(events: EventItem[]): EventRow[] {
  return events.map((e) => ({
    id: e.id,
    title: e.title,
    starts_at: e.startsAt,
    ends_at: e.endsAt,
    location: e.location,
    notes: e.notes ?? null,
    recurrence: e.rrule ? describeRRule(e.rrule) : null,
  }));
}

export function toListRows(lists: import("@/lib/api").List[]): ListRow[] {
  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    task_id: l.taskId,
    event_id: l.eventId,
    items: (l.items ?? []).map((item) => ({
      id: item.id,
      body: item.body,
      completed_at: item.completedAt,
      sort_order: item.sortOrder,
    })),
  }));
}

export function toReminderRows(
  reminders: Reminder[],
  parents?: { tasks?: Task[]; events?: EventItem[] }
): ReminderRow[] {
  const taskTitle = new Map((parents?.tasks ?? []).map((t) => [t.id, t.title]));
  const eventTitle = new Map((parents?.events ?? []).map((e) => [e.id, e.title]));
  return reminders.map((r) => ({
    id: r.id,
    message: r.title,
    fire_at: r.nextFireAt ?? r.fireAt ?? r.createdAt,
    status: r.status === "scheduled" ? "pending" : r.status === "done" ? "sent" : "cancelled",
    recurring: Boolean(r.rrule),
    until_completed: r.untilCompleted,
    parent: r.taskId
      ? { type: "task" as const, id: r.taskId, title: taskTitle.get(r.taskId) ?? "Task" }
      : r.eventId
        ? { type: "event" as const, id: r.eventId, title: eventTitle.get(r.eventId) ?? "Event" }
        : null,
  }));
}

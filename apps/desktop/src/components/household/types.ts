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
  list_id: string | null;
  assignee: { display_name: string } | null;
  series_id: string | null;
  /** Human recurrence label ("every week on Sun"), null for one-off todos. */
  recurrence: string | null;
  nag_interval_min: number;
};

export type ListRow = {
  id: string;
  name: string;
};

export type EventRow = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  /** Human recurrence label, null for one-off events. */
  recurrence: string | null;
};

export type ReminderRow = {
  id: string;
  message: string;
  fire_at: string;
  status: string; // pending | sent | cancelled
  recurring: boolean;
};

/** Event pre-localized to the household timezone for the client calendar. */
export type CalendarEvent = {
  id: string;
  title: string;
  /** YYYY-MM-DD in the household timezone. */
  day: string;
  time: string;
  location: string | null;
  /** Set for occurrences of a recurring series (id = the series id). */
  recurrence: string | null;
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
      list_id: t.listId,
      assignee: t.assigneeMemberId ? { display_name: nameOf.get(t.assigneeMemberId) ?? "?" } : null,
      series_id: t.seriesId,
      recurrence: s ? describeRRule(s.rrule) : t.rrule ? describeRRule(t.rrule) : null,
      nag_interval_min: t.nagIntervalMin,
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
    recurrence: e.rrule ? describeRRule(e.rrule) : null,
  }));
}

export function toReminderRows(reminders: Reminder[]): ReminderRow[] {
  return reminders.map((r) => ({
    id: r.id,
    message: r.title,
    fire_at: r.nextFireAt ?? r.fireAt ?? r.createdAt,
    status: r.status === "scheduled" ? "pending" : r.status === "done" ? "sent" : "cancelled",
    recurring: Boolean(r.rrule),
  }));
}

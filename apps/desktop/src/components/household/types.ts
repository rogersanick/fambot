import type { EventItem, Identity, Member, Reminder, Task } from "@/lib/api";

/** Row shapes the ported UI components render (kept from the old portal). */

export type MemberRow = {
  id: string;
  display_name: string;
  role: string;
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
};

// --- adapters: API rows -> UI rows ---------------------------------------------

export function toMemberRows(members: Member[], identities: Identity[]): MemberRow[] {
  const handleOf = new Map<string, string>();
  for (const i of identities) if (i.type === "imessage") handleOf.set(i.memberId, i.value);
  return members.map((m) => ({
    id: m.id,
    display_name: m.displayName,
    role: m.role,
    handle: handleOf.get(m.id) ?? null,
  }));
}

export function toTaskRows(tasks: Task[], members: Member[]): TaskRow[] {
  const nameOf = new Map(members.map((m) => [m.id, m.displayName]));
  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    due_at: t.dueAt,
    completed_at: t.completedAt,
    list_id: t.listId,
    assignee: t.assigneeMemberId ? { display_name: nameOf.get(t.assigneeMemberId) ?? "?" } : null,
  }));
}

export function toEventRows(events: EventItem[]): EventRow[] {
  return events.map((e) => ({
    id: e.id,
    title: e.title,
    starts_at: e.startsAt,
    ends_at: e.endsAt,
    location: e.location,
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

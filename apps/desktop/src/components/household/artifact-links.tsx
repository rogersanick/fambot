import { useQuery } from "@tanstack/react-query";
import { Bell, MessageCircle, Smartphone } from "lucide-react";
import type { ArtifactType } from "@fambot/shared";
import { api } from "@/lib/api";
import { fmtTime, fmtWhen, localDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ArtifactLink } from "./artifact-link";
import type { EventRow, ListRow, ReminderRow, TaskRow } from "./types";

export const selectClass =
  "border-input h-11 w-full rounded-md border bg-transparent px-3 text-base shadow-xs outline-none sm:h-9 sm:text-sm";

export type LinkedArtifact = { type: ArtifactType; id: string; title: string; when?: string };
export type NotificationKind = "sms" | "imessage" | "push";

const TYPE_LABEL: Record<ArtifactType, string> = {
  task: "Task",
  event: "Event",
  list: "List",
  reminder: "Reminder",
};

const CHANNEL_LABEL: Record<NotificationKind, string> = {
  sms: "SMS",
  imessage: "iMessage",
  push: "app push",
};

/** Time shown on a reminder chip: clock time when it shares a day with the parent, otherwise a dated label. */
export function reminderChipWhen(fireAt: string, tz: string, sameDayAs?: string | null): string {
  if (sameDayAs && localDate(new Date(fireAt), tz) === localDate(new Date(sameDayAs), tz)) {
    return fmtTime(fireAt, tz);
  }
  return fmtWhen(fireAt, tz);
}

export function reminderChipLabel(when: string, channels: NotificationKind[]): string {
  if (channels.length === 0) return `Reminder at ${when}`;
  return `Reminder at ${when} via ${channels.map((channel) => CHANNEL_LABEL[channel]).join(" and ")}`;
}

function toReminderLink(reminder: ReminderRow, tz: string, sameDayAs?: string | null): LinkedArtifact {
  const when = reminderChipWhen(reminder.fire_at, tz, sameDayAs);
  const repeatsParent = reminder.message === reminder.parent?.title;
  return {
    type: "reminder",
    id: reminder.id,
    title: repeatsParent ? "" : reminder.message,
    when,
  };
}

function ArtifactChip({ link, channels }: { link: LinkedArtifact; channels: NotificationKind[] }) {
  const isReminder = link.type === "reminder" && Boolean(link.when);
  const when = link.when!;
  const label = isReminder ? reminderChipLabel(when, channels) : `${TYPE_LABEL[link.type]} · ${link.title}`;
  const tooltip = isReminder ? link.title || label : undefined;
  return (
    <ArtifactLink
      type={link.type}
      id={link.id}
      title={tooltip}
      aria-label={isReminder ? label : undefined}
      className={cn(
        "text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] no-underline hover:underline",
        isReminder ? "shrink-0" : "max-w-[16rem] truncate"
      )}
    >
      {isReminder ? (
        <>
          {channels.includes("sms") ? <Smartphone className="size-3 shrink-0" aria-hidden /> : null}
          {channels.includes("imessage") ? <MessageCircle className="size-3 shrink-0" aria-hidden /> : null}
          {channels.length === 0 ? <Bell className="size-3 shrink-0" aria-hidden /> : null}
          <span>{when}</span>
        </>
      ) : (
        `${TYPE_LABEL[link.type]} · ${link.title}`
      )}
    </ArtifactLink>
  );
}

export function parseParentValue(value: string): { taskId: string | null; eventId: string | null } {
  if (value.startsWith("task:")) return { taskId: value.slice(5), eventId: null };
  if (value.startsWith("event:")) return { taskId: null, eventId: value.slice(6) };
  return { taskId: null, eventId: null };
}

export function parentValue(taskId?: string | null, eventId?: string | null) {
  if (taskId) return `task:${taskId}`;
  if (eventId) return `event:${eventId}`;
  return "";
}

export function ArtifactLinkChips({
  householdId,
  links,
  className,
}: {
  householdId?: string;
  links: LinkedArtifact[];
  className?: string;
}) {
  const channelsQ = useQuery({
    queryKey: ["notification-channels", householdId],
    queryFn: () => api.notificationChannels.get(householdId!),
    enabled: Boolean(householdId),
  });
  const enabledChannels = (channelsQ.data?.channels ?? [])
    .filter((channel) => channel.enabled)
    .map((channel) => channel.channel);
  if (links.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {links.map((link) => (
        <ArtifactChip key={`${link.type}:${link.id}`} link={link} channels={enabledChannels} />
      ))}
    </div>
  );
}

/** Unlink the current list (if any), then attach `nextListId` to the event. */
export function listEventLinkPatches(
  eventId: string,
  currentListId: string | null,
  nextListId: string
): Array<{ listId: string; eventId: string | null }> {
  const next = nextListId || null;
  if (currentListId === next) return [];
  const patches: Array<{ listId: string; eventId: string | null }> = [];
  if (currentListId) patches.push({ listId: currentListId, eventId: null });
  if (next) patches.push({ listId: next, eventId });
  return patches;
}

export function ArtifactSelect({
  name,
  label,
  options,
  emptyLabel = "None",
  defaultValue,
  value,
  onChange,
}: {
  name?: string;
  label: string;
  options: Array<{ id: string; title: string }>;
  emptyLabel?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (id: string) => void;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <select
        name={name}
        className={selectClass}
        defaultValue={onChange ? undefined : (defaultValue ?? "")}
        value={onChange ? (value ?? "") : undefined}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
      >
        <option value="">{emptyLabel}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.title}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Task XOR event (or neither) — used by reminders. */
export function ArtifactParentSelect({
  name = "parent",
  label = "About",
  tasks,
  events,
  emptyLabel = "One-off (no task or event)",
  defaultTaskId,
  defaultEventId,
  value,
  onChange,
}: {
  name?: string;
  label?: string;
  tasks: Array<{ id: string; title: string }>;
  events: Array<{ id: string; title: string }>;
  emptyLabel?: string;
  defaultTaskId?: string | null;
  defaultEventId?: string | null;
  value?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <select
        name={name}
        className={selectClass}
        defaultValue={onChange ? undefined : parentValue(defaultTaskId, defaultEventId)}
        value={onChange ? value : undefined}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
      >
        <option value="">{emptyLabel}</option>
        {tasks.length > 0 && (
          <optgroup label="Tasks">
            {tasks.map((task) => (
              <option key={task.id} value={`task:${task.id}`}>
                {task.title}
              </option>
            ))}
          </optgroup>
        )}
        {events.length > 0 && (
          <optgroup label="Events">
            {events.map((event) => (
              <option key={event.id} value={`event:${event.id}`}>
                {event.title}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </label>
  );
}

export function taskLinks(
  task: TaskRow,
  ctx: { lists: ListRow[]; events: EventRow[]; reminders: ReminderRow[]; tz: string }
): LinkedArtifact[] {
  const links: LinkedArtifact[] = [];
  const event = ctx.events.find((row) => row.id === task.event_id);
  if (event) links.push({ type: "event", id: event.id, title: event.title });
  for (const list of ctx.lists.filter((row) => row.task_id === task.id)) {
    links.push({ type: "list", id: list.id, title: list.name });
  }
  for (const reminder of ctx.reminders.filter(
    (row) => row.status === "pending" && row.parent?.type === "task" && row.parent.id === task.id
  )) {
    links.push(toReminderLink(reminder, ctx.tz, task.due_at));
  }
  return links;
}

export function eventLinks(
  event: EventRow,
  ctx: { tasks: TaskRow[]; lists: ListRow[]; reminders: ReminderRow[]; tz: string }
): LinkedArtifact[] {
  const links: LinkedArtifact[] = [];
  for (const task of ctx.tasks.filter((row) => row.event_id === event.id && row.status !== "cancelled")) {
    links.push({ type: "task", id: task.id, title: task.title });
  }
  for (const list of ctx.lists.filter((row) => row.event_id === event.id)) {
    links.push({ type: "list", id: list.id, title: list.name });
  }
  for (const reminder of ctx.reminders.filter(
    (row) => row.status === "pending" && row.parent?.type === "event" && row.parent.id === event.id
  )) {
    links.push(toReminderLink(reminder, ctx.tz, event.starts_at));
  }
  return links;
}

export function reminderLinks(reminder: ReminderRow): LinkedArtifact[] {
  if (!reminder.parent) return [];
  return [{ type: reminder.parent.type, id: reminder.parent.id, title: reminder.parent.title }];
}

/** Homepage timeline and calendar list tasks/events/lists — reminders live on the item page. */
export function withoutReminders(links: LinkedArtifact[]): LinkedArtifact[] {
  return links.filter((link) => link.type !== "reminder");
}

export function listLinks(
  list: ListRow,
  ctx: { tasks: TaskRow[]; events: EventRow[] }
): LinkedArtifact[] {
  const links: LinkedArtifact[] = [];
  const task = ctx.tasks.find((row) => row.id === list.task_id);
  if (task) links.push({ type: "task", id: task.id, title: task.title });
  const event = ctx.events.find((row) => row.id === list.event_id);
  if (event) links.push({ type: "event", id: event.id, title: event.title });
  return links;
}

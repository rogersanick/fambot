import { eq } from "drizzle-orm";
import {
  checklistItems,
  events,
  households,
  lists,
  members,
  reminders,
  tasks,
  type Db,
} from "@fambot/database";
import { formatLocal } from "@fambot/domain";
import {
  ARTIFACT_TYPE_LABEL,
  isArtifactId,
  isArtifactType,
  type ArtifactType,
} from "@fambot/shared";

export type ArtifactPreview = {
  type: ArtifactType;
  id: string;
  title: string;
  label: string;
  ogTitle: string;
  description: string;
  status: string | null;
  when: string | null;
  timezone: string | null;
};

export type ArtifactPreviewRecord = ArtifactPreview & { householdId: string };

export function parseArtifactParams(type: string, id: string): { type: ArtifactType; id: string } | null {
  const normalized = type.toLowerCase();
  if (!isArtifactType(normalized) || !isArtifactId(id)) return null;
  return { type: normalized, id };
}

export async function loadArtifactPreview(
  db: Db,
  type: ArtifactType,
  id: string
): Promise<ArtifactPreviewRecord | null> {
  if (type === "task") {
    const [row] = await db
      .select({
        id: tasks.id,
        householdId: tasks.householdId,
        title: tasks.title,
        status: tasks.status,
        dueAt: tasks.dueAt,
        timezone: tasks.timezone,
        householdTimezone: households.timezone,
        assigneeName: members.displayName,
      })
      .from(tasks)
      .innerJoin(households, eq(households.id, tasks.householdId))
      .leftJoin(members, eq(members.id, tasks.assigneeMemberId))
      .where(eq(tasks.id, id));
    if (!row) return null;
    const tz = row.timezone ?? row.householdTimezone;
    const when = row.dueAt ? formatLocal(row.dueAt, tz) : null;
    const parts = [when ? `Due ${when}` : "No due date", row.assigneeName ? `assigned to ${row.assigneeName}` : null, row.status];
    return preview("task", row.id, row.householdId, row.title, parts, row.status, row.dueAt?.toISOString() ?? null, tz);
  }

  if (type === "reminder") {
    const [row] = await db
      .select({
        id: reminders.id,
        householdId: reminders.householdId,
        title: reminders.title,
        status: reminders.status,
        nextFireAt: reminders.nextFireAt,
        fireAt: reminders.fireAt,
        timezone: reminders.timezone,
        rrule: reminders.rrule,
        taskTitle: tasks.title,
        eventTitle: events.title,
      })
      .from(reminders)
      .leftJoin(tasks, eq(tasks.id, reminders.taskId))
      .leftJoin(events, eq(events.id, reminders.eventId))
      .where(eq(reminders.id, id));
    if (!row) return null;
    const fire = row.nextFireAt ?? row.fireAt;
    const when = fire ? formatLocal(fire, row.timezone) : null;
    const parent = row.taskTitle
      ? `for task “${row.taskTitle}”`
      : row.eventTitle
        ? `for event “${row.eventTitle}”`
        : "one-off";
    const parts = [
      when ? `Fires ${when}` : "No fire time",
      parent,
      row.rrule ? "recurring" : "one-shot",
      row.status,
    ];
    return preview(
      "reminder",
      row.id,
      row.householdId,
      row.title,
      parts,
      row.status,
      fire?.toISOString() ?? null,
      row.timezone
    );
  }

  if (type === "list") {
    const [row] = await db
      .select({
        id: lists.id,
        householdId: lists.householdId,
        name: lists.name,
        timezone: households.timezone,
        taskTitle: tasks.title,
        eventTitle: events.title,
      })
      .from(lists)
      .innerJoin(households, eq(households.id, lists.householdId))
      .leftJoin(tasks, eq(tasks.id, lists.taskId))
      .leftJoin(events, eq(events.id, lists.eventId))
      .where(eq(lists.id, id));
    if (!row) return null;
    const items = await db
      .select({ completedAt: checklistItems.completedAt })
      .from(checklistItems)
      .where(eq(checklistItems.listId, id));
    const open = items.filter((item) => !item.completedAt).length;
    const parts = [
      `${items.length} ${items.length === 1 ? "item" : "items"}`,
      `${open} remaining`,
      row.taskTitle ? `task “${row.taskTitle}”` : null,
      row.eventTitle ? `event “${row.eventTitle}”` : null,
    ];
    return preview("list", row.id, row.householdId, row.name, parts, null, null, row.timezone);
  }

  const [row] = await db
    .select({
      id: events.id,
      householdId: events.householdId,
      title: events.title,
      notes: events.notes,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      location: events.location,
      timezone: events.timezone,
      householdTimezone: households.timezone,
      rrule: events.rrule,
    })
    .from(events)
    .innerJoin(households, eq(households.id, events.householdId))
    .where(eq(events.id, id));
  if (!row) return null;
  const tz = row.timezone ?? row.householdTimezone;
  const start = formatLocal(row.startsAt, tz);
  const end = row.endsAt ? formatLocal(row.endsAt, tz) : null;
  const parts = [end ? `${start} – ${end}` : start, row.location, row.notes, row.rrule ? "recurring" : null];
  return preview("event", row.id, row.householdId, row.title, parts, null, row.startsAt.toISOString(), tz);
}

export function toPublicPreview(record: ArtifactPreviewRecord): ArtifactPreview {
  const { householdId: _householdId, ...preview } = record;
  return preview;
}

export function renderArtifactOgHtml(args: {
  preview: ArtifactPreview;
  canonicalUrl: string;
}): string {
  const title = escapeHtml(args.preview.ogTitle);
  const description = escapeHtml(args.preview.description);
  const url = escapeHtml(args.canonicalUrl);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${url}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
</head>
<body>
  <h1>${title}</h1>
  <p>${description}</p>
  <p><a href="${url}">Open in Fambot</a></p>
</body>
</html>`;
}

function preview(
  type: ArtifactType,
  id: string,
  householdId: string,
  title: string,
  parts: Array<string | null | undefined>,
  status: string | null,
  when: string | null,
  timezone: string | null
): ArtifactPreviewRecord {
  const label = ARTIFACT_TYPE_LABEL[type];
  const description = parts.filter((part): part is string => Boolean(part && part.trim())).join(" · ");
  return {
    type,
    id,
    householdId,
    title,
    label,
    ogTitle: `${label}: ${title}`,
    description,
    status,
    when,
    timezone,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Used by the agent when a conversation is scoped to one portal item. */
export async function loadFocusedArtifact(
  db: Db,
  type: ArtifactType,
  id: string
): Promise<{ type: ArtifactType; id: string; title: string; details: string } | null> {
  const record = await loadArtifactPreview(db, type, id);
  if (!record) return null;
  return {
    type: record.type,
    id: record.id,
    title: record.title,
    details: record.description,
  };
}

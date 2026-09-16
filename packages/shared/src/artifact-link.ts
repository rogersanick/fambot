export const ARTIFACT_TYPES = ["task", "reminder", "list", "event"] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export type ArtifactRef = { type: ArtifactType; id: string };

export const ARTIFACT_TYPE_LABEL: Record<ArtifactType, string> = {
  task: "Task",
  reminder: "Reminder",
  list: "List",
  event: "Event",
};

const CREATE_TOOL_ID: Record<string, { type: ArtifactType; field: string }> = {
  create_task: { type: "task", field: "taskId" },
  create_reminder: { type: "reminder", field: "reminderId" },
  create_list: { type: "list", field: "listId" },
  create_event: { type: "event", field: "eventId" },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isArtifactType(value: string): value is ArtifactType {
  return (ARTIFACT_TYPES as readonly string[]).includes(value);
}

export function isArtifactId(value: string): boolean {
  return UUID_RE.test(value);
}

export function artifactPath(type: ArtifactType, id: string): string {
  return `/${type}/${id}`;
}

export function artifactUrl(appUrl: string, type: ArtifactType, id: string): string {
  return `${appUrl.replace(/\/$/, "")}${artifactPath(type, id)}`;
}

export function parseArtifactLocation(pathname: string): ArtifactRef | null {
  const match = pathname.match(/^\/(task|reminder|list|event)\/([^/]+)\/?$/i);
  if (!match) return null;
  const id = match[2]!;
  if (!UUID_RE.test(id)) return null;
  return { type: match[1]!.toLowerCase() as ArtifactType, id };
}

/** Pathname from a full URL, relative href, or bare path — used to SPA-route chat links. */
export function parseArtifactHref(href: string): ArtifactRef | null {
  try {
    return parseArtifactLocation(new URL(href, "https://fambot.invalid").pathname);
  } catch {
    return parseArtifactLocation(href);
  }
}

export function conversationFocusExternalId(type: ArtifactType, id: string): string {
  return `${type}:${id}`;
}

export function parseConversationFocus(externalId: string | null | undefined): ArtifactRef | null {
  if (!externalId) return null;
  const match = externalId.match(/^(task|reminder|list|event):([^:]+)$/i);
  if (!match) return null;
  const id = match[2]!;
  if (!UUID_RE.test(id)) return null;
  return { type: match[1]!.toLowerCase() as ArtifactType, id };
}

export type ArtifactToolStep = {
  toolName: string;
  status: string;
  data: unknown;
};

function pushArtifact(out: ArtifactRef[], seen: Set<string>, type: ArtifactType, id: unknown) {
  if (typeof id !== "string" || !UUID_RE.test(id)) return;
  const key = `${type}:${id}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ type, id });
}

/** Successful create_* tools — plus nested list/reminder ids on create_event. */
export function createdArtifactsFromSteps(steps: ArtifactToolStep[]): ArtifactRef[] {
  const seen = new Set<string>();
  const out: ArtifactRef[] = [];
  for (const step of steps) {
    if (step.status !== "executed") continue;
    const data = step.data && typeof step.data === "object" ? (step.data as Record<string, unknown>) : null;
    if (step.toolName === "create_reminder" && data) {
      const parentType = data.taskId ? "task" : data.eventId ? "event" : null;
      if (parentType) {
        pushArtifact(out, seen, parentType, data.taskId ?? data.eventId);
        continue;
      }
    }
    if (step.toolName === "create_event" && data) {
      pushArtifact(out, seen, "event", data.eventId);
      pushArtifact(out, seen, "list", data.listId);
      if (Array.isArray(data.reminderIds)) {
        for (const id of data.reminderIds) pushArtifact(out, seen, "reminder", id);
      }
      continue;
    }
    const mapping = CREATE_TOOL_ID[step.toolName];
    if (!mapping) continue;
    pushArtifact(out, seen, mapping.type, data?.[mapping.field]);
  }
  return out;
}

export function appendArtifactLinks(reply: string, appUrl: string, artifacts: ArtifactRef[]): string {
  if (artifacts.length === 0) return reply;
  const missing = artifacts
    .map((artifact) => artifactUrl(appUrl, artifact.type, artifact.id))
    .filter((url) => !reply.includes(url));
  if (missing.length === 0) return reply;
  return `${reply.trimEnd()}\n\n${missing.join("\n")}`;
}

export function withArtifactLinks(args: {
  reply: string | null;
  steps: ArtifactToolStep[];
  appUrl: string;
  skipReply?: string;
}): string | null {
  if (!args.reply) return args.reply;
  if (args.skipReply && args.reply === args.skipReply) return args.reply;
  return appendArtifactLinks(args.reply, args.appUrl, createdArtifactsFromSteps(args.steps));
}

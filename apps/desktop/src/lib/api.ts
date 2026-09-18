/**
 * Typed REST client for the Fambot API. All requests are cookie-authenticated
 * (Better Auth session). In dev, Vite proxies /api to localhost:8787.
 */

const base = import.meta.env.VITE_API_URL ?? "";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}/api${path}`, {
    credentials: "include",
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, apiErrorMessage(res.status, body));
  }
  return (await res.json()) as T;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

function apiErrorMessage(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown; error?: unknown };
    if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message;
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error;
  } catch {
    // keep the raw body when it isn't JSON
  }
  return body || `Request failed (${status})`;
}

// --- server row shapes (drizzle camelCase over JSON) --------------------------

export type Household = { id: string; name: string; timezone: string; botName: string };
export type Member = {
  id: string;
  householdId: string;
  userId: string | null;
  displayName: string;
  role: "owner" | "member";
};
export type Identity = { id: string; memberId: string; type: string; value: string };
export type HouseholdInvite = {
  id: string;
  memberId: string;
  displayName: string;
  state: "pending" | "expired" | "accepted";
  smsStatus: "pending" | "queued" | "sent" | "delivered" | "failed";
  sendError: string | null;
  expiresAt: string;
};
export type InvitePreview = {
  id: string;
  household: { id: string; name: string };
  member: { id: string; displayName: string; phone: string | null };
  expiresAt: string;
  state: "pending" | "expired" | "accepted";
  smsStatus: HouseholdInvite["smsStatus"];
};
export type Task = {
  id: string;
  title: string;
  status: "open" | "done" | "cancelled";
  eventId: string | null;
  assigneeMemberId: string | null;
  dueAt: string | null;
  rrule: string | null;
  seriesId: string | null;
  scheduledFor: string | null;
  completedAt: string | null;
  createdAt: string;
};
export type TaskSeries = {
  id: string;
  title: string;
  rrule: string;
  timezone: string;
  status: "active" | "exhausted" | "cancelled";
  nextOccurrenceAt: string | null;
  assigneeMemberId: string | null;
};
export type ChecklistItem = {
  id: string;
  listId: string;
  body: string;
  completedAt: string | null;
  sortOrder: number;
};
export type List = {
  id: string;
  name: string;
  taskId: string | null;
  eventId: string | null;
  items?: ChecklistItem[];
};
export type Reminder = {
  id: string;
  title: string;
  status: "scheduled" | "done" | "cancelled";
  fireAt: string | null;
  nextFireAt: string | null;
  rrule: string | null;
  taskId: string | null;
  eventId: string | null;
  untilCompleted: boolean;
  createdAt: string;
};
export type EventItem = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  notes: string | null;
  rrule: string | null;
  source: "internal" | "google";
};
export type CommentSubjectType = "task" | "event" | "list";
export type Comment = {
  id: string;
  body: string;
  createdAt: string;
  authorMemberId: string | null;
  authorName: string | null;
};
export type ChatMessage = {
  id: string;
  direction: "inbound" | "outbound";
  text: string;
  sentAt: string;
  senderMemberId: string | null;
};
export type ArtifactPreview = {
  type: "task" | "reminder" | "list" | "event";
  id: string;
  title: string;
  label: string;
  ogTitle: string;
  description: string;
  status: string | null;
  when: string | null;
  timezone: string | null;
};
export type BridgeStatus = { connected: boolean; lastSeen: string | null };
export type SmsStatus = {
  configured: boolean;
  fromNumber: string | null;
  apiKeySet?: boolean;
  inboundReady?: boolean;
};
export type Integrations = {
  google: { configured: boolean; connected: boolean; email: string | null };
  sms: SmsStatus;
  bridge: BridgeStatus;
};
export type NotificationChannel = {
  id: string;
  channel: "sms" | "imessage";
  enabled: boolean;
  conversationId: string | null;
};
export type NotificationChannelsResponse = {
  channels: NotificationChannel[];
  imessageConversations: Array<{ id: string; name: string | null; kind: "direct" | "group" }>;
  sms: SmsStatus;
  bridge: BridgeStatus;
};

export type Me = {
  user: { id: string; name: string; email: string };
  memberships: Array<{ member: Member; household: Household }>;
  googleAuthEnabled: boolean;
};

export type HouseholdBundle = {
  household: Household;
  members: Member[];
  identities: Identity[];
  invites: HouseholdInvite[];
  me: Member;
  bridge: BridgeStatus;
};

// --- endpoints -----------------------------------------------------------------

const commentPath: Record<CommentSubjectType, string> = {
  task: "tasks",
  event: "events",
  list: "lists",
};

export const api = {
  config: () =>
    req<{ googleAuth: boolean; aiConfigured: boolean }>("/config").catch(() => ({
      googleAuth: false,
      aiConfigured: false,
    })),
  me: () => req<Me>("/me"),
  createHousehold: (body: {
    name: string;
    timezone: string;
    ownerPhone: string;
    usePhoneForImessage?: boolean;
  }) =>
    req<{ household: Household; member: Member }>("/households", { method: "POST", body: JSON.stringify(body) }),
  household: (hid: string) => req<HouseholdBundle>(`/households/${hid}`),
  updateHousehold: (hid: string, body: { name?: string; timezone?: string; botName?: string }) =>
    req<{ household: Household }>(`/households/${hid}`, { method: "PATCH", body: JSON.stringify(body) }),
  createInvite: (hid: string, body: { displayName: string; phone: string }) =>
    req<{ member: Member; invite: HouseholdInvite }>(`/households/${hid}/invites`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  invite: (token: string) =>
    req<{ invite: InvitePreview }>("/invites/preview", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  acceptInvite: (token: string) =>
    req<{ ok: true; householdId: string; memberId: string }>("/invites/accept", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  resendInvite: (hid: string, inviteId: string) =>
    req<{ invite: HouseholdInvite }>(`/households/${hid}/invites/${inviteId}/resend`, {
      method: "POST",
    }),
  cancelInvite: (hid: string, inviteId: string) =>
    req<{ ok: true }>(`/households/${hid}/invites/${inviteId}`, { method: "DELETE" }),
  setMemberPhone: (hid: string, mid: string, phone: string) =>
    req<{ phone: string }>(`/households/${hid}/members/${mid}/phone`, {
      method: "PATCH",
      body: JSON.stringify({ phone }),
    }),
  setMemberImessage: (hid: string, mid: string, handle: string | null) =>
    req<{ handle: string | null }>(`/households/${hid}/members/${mid}/imessage`, {
      method: "PATCH",
      body: JSON.stringify({ handle }),
    }),

  notificationChannels: {
    get: (hid: string) => req<NotificationChannelsResponse>(`/households/${hid}/notification-channels`),
    update: (hid: string, body: { channel: "sms" | "imessage"; enabled: boolean; conversationId?: string | null }) =>
      req<{ channel: NotificationChannel }>(`/households/${hid}/notification-channels`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
  },

  chat: {
    get: (hid: string) => req<{ conversationId: string; messages: ChatMessage[] }>(`/households/${hid}/chat`),
    send: (hid: string, text: string) =>
      req<{ conversationId: string; reply: string | null }>(`/households/${hid}/chat`, {
        method: "POST",
        body: JSON.stringify({ text }),
      }),
  },

  artifacts: {
    preview: (type: ArtifactPreview["type"], id: string) =>
      req<{ artifact: ArtifactPreview }>(`/public/artifacts/${type}/${id}`),
    chat: {
      get: (hid: string, type: ArtifactPreview["type"], id: string) =>
        req<{ conversationId: string; messages: ChatMessage[] }>(`/households/${hid}/items/${type}/${id}/chat`),
      send: (hid: string, type: ArtifactPreview["type"], id: string, text: string) =>
        req<{ conversationId: string; reply: string | null }>(`/households/${hid}/items/${type}/${id}/chat`, {
          method: "POST",
          body: JSON.stringify({ text }),
        }),
    },
  },

  reminders: {
    list: (hid: string) => req<{ reminders: Reminder[] }>(`/households/${hid}/reminders`),
    create: (
      hid: string,
      body: {
        title: string;
        fireAt: string | null;
        rrule?: string | null;
        taskId?: string | null;
        eventId?: string | null;
        untilCompleted?: boolean;
      }
    ) => req<{ reminder: Reminder }>(`/households/${hid}/reminders`, { method: "POST", body: JSON.stringify(body) }),
    patch: (
      hid: string,
      rid: string,
      body: { taskId?: string | null; eventId?: string | null }
    ) => req<{ reminder: Reminder }>(`/households/${hid}/reminders/${rid}`, { method: "PATCH", body: JSON.stringify(body) }),
    cancel: (hid: string, rid: string) =>
      req<{ ok: true }>(`/households/${hid}/reminders/${rid}`, { method: "DELETE" }),
  },

  tasks: {
    list: (hid: string) => req<{ tasks: Task[]; lists: List[]; series: TaskSeries[] }>(`/households/${hid}/tasks`),
    create: (
      hid: string,
      body: {
        title: string;
        dueAt?: string | null;
        eventId?: string | null;
        assigneeMemberId?: string | null;
        rrule?: string | null;
        checklist?: { title: string; items: string[] };
        listId?: string | null;
        reminder?: { fireAt: string; rrule?: string | null; untilCompleted?: boolean };
      }
    ) => req<{ task: Task }>(`/households/${hid}/tasks`, { method: "POST", body: JSON.stringify(body) }),
    patch: (
      hid: string,
      tid: string,
      body: {
        status?: "open" | "done" | "cancelled";
        title?: string;
        dueAt?: string | null;
        eventId?: string | null;
      }
    ) => req<unknown>(`/households/${hid}/tasks/${tid}`, { method: "PATCH", body: JSON.stringify(body) }),
  },

  taskSeries: {
    patch: (
      hid: string,
      sid: string,
      body: { title?: string; rrule?: string }
    ) => req<{ series: TaskSeries }>(`/households/${hid}/task-series/${sid}`, { method: "PATCH", body: JSON.stringify(body) }),
    cancel: (hid: string, sid: string) =>
      req<{ ok: true }>(`/households/${hid}/task-series/${sid}`, { method: "DELETE" }),
  },

  lists: {
    create: (hid: string, name: string, links?: { taskId?: string | null; eventId?: string | null }) =>
      req<{ list: List }>(`/households/${hid}/lists`, { method: "POST", body: JSON.stringify({ name, ...links }) }),
    rename: (hid: string, lid: string, name: string) =>
      req<{ list: List }>(`/households/${hid}/lists/${lid}`, { method: "PATCH", body: JSON.stringify({ name }) }),
    patch: (
      hid: string,
      lid: string,
      body: { name?: string; taskId?: string | null; eventId?: string | null }
    ) => req<{ list: List }>(`/households/${hid}/lists/${lid}`, { method: "PATCH", body: JSON.stringify(body) }),
    remove: (hid: string, lid: string) => req<{ ok: true }>(`/households/${hid}/lists/${lid}`, { method: "DELETE" }),
    addItems: (hid: string, lid: string, items: string[]) =>
      req<{ items: ChecklistItem[] }>(`/households/${hid}/lists/${lid}/items`, {
        method: "POST",
        body: JSON.stringify({ items }),
      }),
    patchItem: (hid: string, lid: string, iid: string, body: { body?: string; completed?: boolean }) =>
      req<{ item: ChecklistItem }>(`/households/${hid}/lists/${lid}/items/${iid}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    removeItem: (hid: string, lid: string, iid: string) =>
      req<{ ok: true }>(`/households/${hid}/lists/${lid}/items/${iid}`, { method: "DELETE" }),
  },

  events: {
    list: (hid: string) => req<{ events: EventItem[] }>(`/households/${hid}/events`),
    create: (
      hid: string,
      body: {
        title: string;
        startsAt: string;
        endsAt?: string | null;
        location?: string | null;
        notes?: string | null;
        rrule?: string | null;
        listId?: string | null;
        reminder?: { fireAt: string; rrule?: string | null };
      }
    ) => req<{ event: EventItem }>(`/households/${hid}/events`, { method: "POST", body: JSON.stringify(body) }),
    remove: (hid: string, eid: string) =>
      req<{ ok: true }>(`/households/${hid}/events/${eid}`, { method: "DELETE" }),
  },

  comments: {
    list: (hid: string, subject: CommentSubjectType, sid: string) =>
      req<{ comments: Comment[] }>(`/households/${hid}/${commentPath[subject]}/${sid}/comments`),
    add: (hid: string, subject: CommentSubjectType, sid: string, body: string) =>
      req<{ comment: Comment }>(`/households/${hid}/${commentPath[subject]}/${sid}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      }),
  },

  integrations: {
    get: () => req<Integrations>("/integrations"),
    googleConnect: () => req<{ url: string }>("/integrations/google/connect", { method: "POST" }),
    googleDisconnect: () => req<{ ok: true }>("/integrations/google", { method: "DELETE" }),
  },
};

/** datetime-local inputs have no timezone; interpret them in the household's tz. */
export function localToIso(value: string, timeZone: string): string | null {
  if (!value) return null;
  const [date, time] = value.split("T");
  const [y, m, d] = date!.split("-").map(Number);
  const [hh, mm] = time!.split(":").map(Number);
  let guess = Date.UTC(y!, m! - 1, d!, hh!, mm!);
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const rendered = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    const want = Date.UTC(y!, m! - 1, d!, hh!, mm!);
    if (rendered === want) break;
    guess += want - rendered;
  }
  return new Date(guess).toISOString();
}

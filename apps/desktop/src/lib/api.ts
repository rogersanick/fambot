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
    throw new ApiError(res.status, body || res.statusText);
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
export type Task = {
  id: string;
  title: string;
  status: "open" | "done" | "cancelled";
  listId: string | null;
  assigneeMemberId: string | null;
  dueAt: string | null;
  rrule: string | null;
  nagIntervalMin: number;
  completedAt: string | null;
  createdAt: string;
};
export type List = { id: string; name: string };
export type Reminder = {
  id: string;
  title: string;
  status: "scheduled" | "done" | "cancelled";
  fireAt: string | null;
  nextFireAt: string | null;
  rrule: string | null;
  createdAt: string;
};
export type EventItem = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  source: "internal" | "google";
};
export type ChatMessage = {
  id: string;
  direction: "inbound" | "outbound";
  text: string;
  sentAt: string;
  senderMemberId: string | null;
};
export type BridgeStatus = { connected: boolean; lastSeen: string | null };
export type Integrations = {
  google: { configured: boolean; connected: boolean; email: string | null };
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
  me: Member;
  bridge: BridgeStatus;
};

// --- endpoints -----------------------------------------------------------------

export const api = {
  config: () => req<{ googleAuth: boolean }>("/config").catch(() => ({ googleAuth: false })),
  me: () => req<Me>("/me"),
  createHousehold: (body: { name: string; timezone: string }) =>
    req<{ household: Household; member: Member }>("/households", { method: "POST", body: JSON.stringify(body) }),
  household: (hid: string) => req<HouseholdBundle>(`/households/${hid}`),
  updateHousehold: (hid: string, body: { name?: string; timezone?: string; botName?: string }) =>
    req<{ household: Household }>(`/households/${hid}`, { method: "PATCH", body: JSON.stringify(body) }),
  addMember: (hid: string, body: { displayName: string; imessageHandle?: string }) =>
    req<{ member: Member }>(`/households/${hid}/members`, { method: "POST", body: JSON.stringify(body) }),

  chat: {
    get: (hid: string) => req<{ conversationId: string; messages: ChatMessage[] }>(`/households/${hid}/chat`),
    send: (hid: string, text: string) =>
      req<{ conversationId: string; reply: string | null }>(`/households/${hid}/chat`, {
        method: "POST",
        body: JSON.stringify({ text }),
      }),
  },

  reminders: {
    list: (hid: string) => req<{ reminders: Reminder[] }>(`/households/${hid}/reminders`),
    create: (hid: string, body: { title: string; fireAt: string | null; rrule?: string | null }) =>
      req<{ reminder: Reminder }>(`/households/${hid}/reminders`, { method: "POST", body: JSON.stringify(body) }),
    cancel: (hid: string, rid: string) =>
      req<{ ok: true }>(`/households/${hid}/reminders/${rid}`, { method: "DELETE" }),
  },

  tasks: {
    list: (hid: string) => req<{ tasks: Task[]; lists: List[] }>(`/households/${hid}/tasks`),
    create: (
      hid: string,
      body: { title: string; dueAt?: string | null; listId?: string | null; assigneeMemberId?: string | null }
    ) => req<{ task: Task }>(`/households/${hid}/tasks`, { method: "POST", body: JSON.stringify(body) }),
    patch: (
      hid: string,
      tid: string,
      body: { status?: "open" | "done" | "cancelled"; title?: string; dueAt?: string | null; listId?: string | null }
    ) => req<unknown>(`/households/${hid}/tasks/${tid}`, { method: "PATCH", body: JSON.stringify(body) }),
  },

  lists: {
    create: (hid: string, name: string) =>
      req<{ list: List }>(`/households/${hid}/lists`, { method: "POST", body: JSON.stringify({ name }) }),
    rename: (hid: string, lid: string, name: string) =>
      req<{ list: List }>(`/households/${hid}/lists/${lid}`, { method: "PATCH", body: JSON.stringify({ name }) }),
    remove: (hid: string, lid: string) => req<{ ok: true }>(`/households/${hid}/lists/${lid}`, { method: "DELETE" }),
  },

  events: {
    list: (hid: string) => req<{ events: EventItem[] }>(`/households/${hid}/events`),
    create: (
      hid: string,
      body: { title: string; startsAt: string; endsAt?: string | null; location?: string | null }
    ) => req<{ event: EventItem }>(`/households/${hid}/events`, { method: "POST", body: JSON.stringify(body) }),
    remove: (hid: string, eid: string) =>
      req<{ ok: true }>(`/households/${hid}/events/${eid}`, { method: "DELETE" }),
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

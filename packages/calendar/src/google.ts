import { eq } from "drizzle-orm";
import type { Db } from "@fambot/database";
import { calendarConnections } from "@fambot/database";
import { decryptToken, encryptToken } from "./crypto";

/**
 * Google Calendar provider — raw REST against calendar/v3, no SDK.
 * Tokens live encrypted in calendar_connections; refresh is automatic.
 */

export type GoogleConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encryptionKey: string;
};

const SCOPES = ["https://www.googleapis.com/auth/calendar.events"].join(" ");

export function googleAuthUrl(cfg: GoogleConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCode(cfg: GoogleConfig, code: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`google token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
}

export async function saveConnection(
  db: Db,
  cfg: GoogleConfig,
  userId: string,
  tokens: { access_token: string; refresh_token?: string; expires_in: number },
  accountEmail?: string
) {
  const accessTokenEnc = await encryptToken(tokens.access_token, cfg.encryptionKey);
  const refreshTokenEnc = tokens.refresh_token
    ? await encryptToken(tokens.refresh_token, cfg.encryptionKey)
    : null;
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  await db
    .insert(calendarConnections)
    .values({ userId, provider: "google", accessTokenEnc, refreshTokenEnc, expiresAt, accountEmail })
    .onConflictDoUpdate({
      target: [calendarConnections.userId, calendarConnections.provider],
      set: {
        accessTokenEnc,
        ...(refreshTokenEnc ? { refreshTokenEnc } : {}),
        expiresAt,
        accountEmail,
        updatedAt: new Date(),
      },
    });
}

export type CreateGoogleEventInput = {
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  location: string | null;
  notes: string | null;
  timezone: string;
  /** RFC-5545 rule; the whole series is created on Google, not occurrences. */
  rrule: string | null;
};

/** Pure payload builder (exported for tests). */
export function buildGoogleEventPayload(input: CreateGoogleEventInput): Record<string, unknown> {
  const end = input.endsAt ?? new Date(input.startsAt.getTime() + 3_600_000);
  const payload: Record<string, unknown> = {
    summary: input.title,
    start: { dateTime: input.startsAt.toISOString(), timeZone: input.timezone },
    end: { dateTime: end.toISOString(), timeZone: input.timezone },
  };
  if (input.location) payload.location = input.location;
  if (input.notes) payload.description = input.notes;
  if (input.rrule) payload.recurrence = [`RRULE:${input.rrule.replace(/^RRULE:/i, "")}`];
  return payload;
}

export class GoogleCalendarProvider {
  constructor(
    private db: Db,
    private cfg: GoogleConfig,
    private userId: string
  ) {}

  static async forUser(db: Db, cfg: GoogleConfig, userId: string): Promise<GoogleCalendarProvider | null> {
    const [conn] = await db
      .select({ id: calendarConnections.id })
      .from(calendarConnections)
      .where(eq(calendarConnections.userId, userId));
    return conn ? new GoogleCalendarProvider(db, cfg, userId) : null;
  }

  private async accessToken(): Promise<string> {
    const [conn] = await this.db
      .select()
      .from(calendarConnections)
      .where(eq(calendarConnections.userId, this.userId));
    if (!conn) throw new Error("no google connection");
    if (conn.expiresAt && conn.expiresAt.getTime() > Date.now() + 60_000) {
      return decryptToken(conn.accessTokenEnc, this.cfg.encryptionKey);
    }
    if (!conn.refreshTokenEnc) throw new Error("google token expired and no refresh token");
    const refreshToken = await decryptToken(conn.refreshTokenEnc, this.cfg.encryptionKey);
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) throw new Error(`google refresh failed: ${res.status}`);
    const tokens = (await res.json()) as { access_token: string; expires_in: number };
    await this.db
      .update(calendarConnections)
      .set({
        accessTokenEnc: await encryptToken(tokens.access_token, this.cfg.encryptionKey),
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        updatedAt: new Date(),
      })
      .where(eq(calendarConnections.id, conn.id));
    return tokens.access_token;
  }

  private async api(path: string, init?: RequestInit): Promise<Response> {
    const token = await this.accessToken();
    return fetch(`https://www.googleapis.com/calendar/v3${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
    });
  }

  async createEvent(input: CreateGoogleEventInput): Promise<{ externalId: string; htmlLink?: string }> {
    const res = await this.api(`/calendars/primary/events`, {
      method: "POST",
      body: JSON.stringify(buildGoogleEventPayload(input)),
    });
    if (!res.ok) throw new Error(`google createEvent failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { id: string; htmlLink?: string };
    return { externalId: data.id, htmlLink: data.htmlLink };
  }

  async searchEvents(input: { start: Date; end: Date; query: string | null }) {
    const params = new URLSearchParams({
      timeMin: input.start.toISOString(),
      timeMax: input.end.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "25",
    });
    if (input.query) params.set("q", input.query);
    const res = await this.api(`/calendars/primary/events?${params}`);
    if (!res.ok) throw new Error(`google searchEvents failed: ${res.status}`);
    const data = (await res.json()) as {
      items?: Array<{ summary?: string; location?: string; start?: { dateTime?: string; date?: string } }>;
    };
    return (data.items ?? [])
      .filter((e) => e.start?.dateTime || e.start?.date)
      .map((e) => ({
        title: e.summary ?? "(untitled)",
        startsAt: new Date(e.start!.dateTime ?? `${e.start!.date}T00:00:00`),
        location: e.location ?? null,
      }));
  }
}

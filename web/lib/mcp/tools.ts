import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Database } from "@/lib/database.types";

type Db = SupabaseClient<Database>;

/**
 * Every tool call runs as the calling Supabase user: we bind a fresh client to
 * the caller's JWT so Postgres RLS is the entire authorization layer. The MCP
 * server grants no extra privileges.
 */
function dbFor(token: string): Db {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

type ToolCtx = { http?: { authInfo?: { token: string; clientId: string } } };

function auth(ctx: unknown): { token: string; userId: string } {
  const info = (ctx as ToolCtx).http?.authInfo;
  if (!info?.token) throw new Error("unauthenticated");
  return { token: info.token, userId: info.clientId };
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function fail(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

function iso(desc: string) {
  return z.string().describe(`${desc} — ISO 8601 with timezone offset, e.g. 2026-08-12T17:00:00-04:00`);
}

/** The caller's member row in a household (for created_by attribution). */
async function callerMemberId(db: Db, householdId: string, userId: string): Promise<string | null> {
  const { data } = await db
    .from("members")
    .select("id")
    .eq("household_id", householdId)
    .eq("user_id", userId)
    .maybeSingle();
  return data?.id ?? null;
}

async function defaultChannelId(db: Db, householdId: string, chatGuid?: string): Promise<string | null> {
  if (chatGuid) {
    const { data } = await db
      .from("channels")
      .select("id")
      .eq("household_id", householdId)
      .eq("chat_guid", chatGuid)
      .maybeSingle();
    return data?.id ?? null;
  }
  const { data } = await db
    .from("channels")
    .select("id")
    .eq("household_id", householdId)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type ToolHandler<A> = (args: A, db: Db, userId: string) => Promise<any>;

export function registerFambotTools(server: McpServer): void {
  // Wraps a handler with auth, the RLS-bound client, and uniform error shape.
  function tool<S extends z.ZodObject<any>>(
    name: string,
    description: string,
    inputSchema: S,
    handler: ToolHandler<z.infer<S>>,
  ) {
    const callback = async (args: z.infer<S>, ctx: unknown) => {
      try {
        const { token, userId } = auth(ctx);
        return ok(await handler(args, dbFor(token), userId));
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    };
    // The SDK's overloads don't infer through our generic wrapper; the schema
    // still validates args at runtime.
    server.registerTool(name, { description, inputSchema }, callback as never);
  }

  tool(
    "get_context",
    "Call this first. Returns the caller's households (members, channels, timezone), the current time, and — when chat_guid is given — which household that iMessage chat belongs to (null household_for_chat means the chat is not set up yet; use setup_household).",
    z.object({
      chat_guid: z.string().optional().describe("iMessage chat GUID to resolve to a household"),
    }),
    async ({ chat_guid }, db) => {
      const { data: households, error } = await db
        .from("households")
        .select(
          "id, name, timezone, members ( id, display_name, role, handle ), channels ( id, chat_guid, name )",
        );
      if (error) throw new Error(error.message);
      let householdForChat: string | null = null;
      if (chat_guid) {
        householdForChat =
          households?.find((h) => h.channels.some((c) => c.chat_guid === chat_guid))?.id ?? null;
      }
      return {
        now: new Date().toISOString(),
        households: households ?? [],
        ...(chat_guid !== undefined ? { household_for_chat: householdForChat } : {}),
      };
    },
  );

  tool(
    "setup_household",
    "Create a new household and become its first member. Use when get_context shows no household for the current chat. Optionally maps the chat in the same call.",
    z.object({
      name: z.string().min(1).describe("Household name, e.g. 'Rogers Family'"),
      timezone: z.string().optional().describe("IANA timezone, e.g. America/New_York"),
      display_name: z.string().optional().describe("Display name for the calling member (e.g. 'FamBot')"),
      role: z.enum(["owner", "agent"]).optional().describe("Caller's role; agents should pass 'agent'"),
      chat_guid: z.string().optional().describe("iMessage chat GUID to map to this household"),
      chat_name: z.string().optional(),
    }),
    async (args, db) => {
      const { data, error } = await db.rpc("setup_household", {
        p_name: args.name,
        p_timezone: args.timezone ?? "America/New_York",
        p_display_name: args.display_name,
        p_role: args.role ?? "owner",
        p_chat_guid: args.chat_guid,
        p_chat_name: args.chat_name,
      });
      if (error) throw new Error(error.message);
      return { household_id: data };
    },
  );

  tool(
    "add_member",
    "Add a family member to a household. handle is their iMessage sender handle (phone in E.164 like +15551234567, or email address they text from), used to recognize who is texting. account_email links an existing portal login to the member.",
    z.object({
      household_id: z.string().uuid(),
      display_name: z.string().min(1),
      handle: z.string().optional(),
      role: z.enum(["owner", "member"]).optional(),
      account_email: z.string().optional().describe("Existing account's email to link (portal login)"),
    }),
    async (args, db) => {
      if (args.account_email) {
        const { data, error } = await db.rpc("add_member_with_email", {
          p_household_id: args.household_id,
          p_display_name: args.display_name,
          p_email: args.account_email,
          p_role: args.role ?? "member",
          p_handle: args.handle?.trim().toLowerCase(),
        });
        if (error) throw new Error(error.message);
        return { id: data, display_name: args.display_name };
      }
      const { data, error } = await db
        .from("members")
        .insert({
          household_id: args.household_id,
          display_name: args.display_name,
          handle: args.handle?.trim().toLowerCase() ?? null,
          role: args.role ?? "member",
        })
        .select("id, display_name, role, handle")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
  );

  tool(
    "list_members",
    "List the members of a household.",
    z.object({ household_id: z.string().uuid() }),
    async ({ household_id }, db) => {
      const { data, error } = await db
        .from("members")
        .select("id, display_name, role, handle")
        .eq("household_id", household_id)
        .order("created_at");
      if (error) throw new Error(error.message);
      return data;
    },
  );

  tool(
    "map_channel",
    "Map an iMessage chat (by GUID) to a household so messages and reminders in that chat resolve to it.",
    z.object({
      household_id: z.string().uuid(),
      chat_guid: z.string().min(1),
      name: z.string().optional(),
    }),
    async (args, db) => {
      const { data, error } = await db
        .from("channels")
        .insert({ household_id: args.household_id, chat_guid: args.chat_guid, name: args.name ?? null })
        .select("id, chat_guid, name")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
  );

  tool(
    "create_task",
    "Add a todo/task to the household list.",
    z.object({
      household_id: z.string().uuid(),
      title: z.string().min(1),
      notes: z.string().optional(),
      assignee_member_id: z.string().uuid().optional().describe("Member the task is assigned to"),
      due_at: iso("Due date/time").optional(),
    }),
    async (args, db, userId) => {
      const createdBy = await callerMemberId(db, args.household_id, userId);
      const { data, error } = await db
        .from("tasks")
        .insert({
          household_id: args.household_id,
          title: args.title,
          notes: args.notes ?? null,
          assignee_id: args.assignee_member_id ?? null,
          due_at: args.due_at ?? null,
          created_by: createdBy,
        })
        .select("id, title, status, due_at, assignee_id")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
  );

  tool(
    "list_tasks",
    "List household tasks. Defaults to open tasks.",
    z.object({
      household_id: z.string().uuid(),
      status: z.enum(["open", "done", "cancelled", "all"]).optional(),
      assignee_member_id: z.string().uuid().optional(),
    }),
    async (args, db) => {
      let q = db
        .from("tasks")
        .select("id, title, notes, status, due_at, completed_at, assignee:members!tasks_assignee_id_fkey ( id, display_name )")
        .eq("household_id", args.household_id)
        .order("due_at", { ascending: true, nullsFirst: false })
        .order("created_at");
      const status = args.status ?? "open";
      if (status !== "all") q = q.eq("status", status);
      if (args.assignee_member_id) q = q.eq("assignee_id", args.assignee_member_id);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data;
    },
  );

  tool(
    "update_task",
    "Update a task: retitle, reassign, change due date, or set status (done to complete, cancelled to drop, open to reopen).",
    z.object({
      task_id: z.string().uuid(),
      title: z.string().optional(),
      notes: z.string().optional(),
      status: z.enum(["open", "done", "cancelled"]).optional(),
      assignee_member_id: z.string().uuid().nullable().optional(),
      due_at: iso("Due date/time").nullable().optional(),
    }),
    async (args, db) => {
      const patch: Database["public"]["Tables"]["tasks"]["Update"] = {};
      if (args.title !== undefined) patch.title = args.title;
      if (args.notes !== undefined) patch.notes = args.notes;
      if (args.status !== undefined) {
        patch.status = args.status;
        patch.completed_at = args.status === "done" ? new Date().toISOString() : null;
      }
      if (args.assignee_member_id !== undefined) patch.assignee_id = args.assignee_member_id;
      if (args.due_at !== undefined) patch.due_at = args.due_at;
      const { data, error } = await db
        .from("tasks")
        .update(patch)
        .eq("id", args.task_id)
        .select("id, title, status, due_at, assignee_id")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
  );

  tool(
    "create_event",
    "Add a calendar event.",
    z.object({
      household_id: z.string().uuid(),
      title: z.string().min(1),
      starts_at: iso("Event start"),
      ends_at: iso("Event end").optional(),
      location: z.string().optional(),
      notes: z.string().optional(),
    }),
    async (args, db, userId) => {
      const createdBy = await callerMemberId(db, args.household_id, userId);
      const { data, error } = await db
        .from("events")
        .insert({
          household_id: args.household_id,
          title: args.title,
          starts_at: args.starts_at,
          ends_at: args.ends_at ?? null,
          location: args.location ?? null,
          notes: args.notes ?? null,
          created_by: createdBy,
        })
        .select("id, title, starts_at, ends_at, location")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
  );

  tool(
    "list_events",
    "List calendar events in a window. Defaults to yesterday through +30 days.",
    z.object({
      household_id: z.string().uuid(),
      from: iso("Window start").optional(),
      to: iso("Window end").optional(),
    }),
    async (args, db) => {
      const from = args.from ?? new Date(Date.now() - 24 * 3600_000).toISOString();
      const to = args.to ?? new Date(Date.now() + 30 * 24 * 3600_000).toISOString();
      const { data, error } = await db
        .from("events")
        .select("id, title, starts_at, ends_at, location, notes")
        .eq("household_id", args.household_id)
        .gte("starts_at", from)
        .lte("starts_at", to)
        .order("starts_at");
      if (error) throw new Error(error.message);
      return data;
    },
  );

  tool(
    "update_event",
    "Update a calendar event's fields.",
    z.object({
      event_id: z.string().uuid(),
      title: z.string().optional(),
      starts_at: iso("Event start").optional(),
      ends_at: iso("Event end").nullable().optional(),
      location: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
    }),
    async (args, db) => {
      const patch: Database["public"]["Tables"]["events"]["Update"] = {};
      if (args.title !== undefined) patch.title = args.title;
      if (args.starts_at !== undefined) patch.starts_at = args.starts_at;
      if (args.ends_at !== undefined) patch.ends_at = args.ends_at;
      if (args.location !== undefined) patch.location = args.location;
      if (args.notes !== undefined) patch.notes = args.notes;
      const { data, error } = await db
        .from("events")
        .update(patch)
        .eq("id", args.event_id)
        .select("id, title, starts_at, ends_at, location")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
  );

  tool(
    "delete_event",
    "Delete a calendar event.",
    z.object({ event_id: z.string().uuid() }),
    async ({ event_id }, db) => {
      const { error } = await db.from("events").delete().eq("id", event_id);
      if (error) throw new Error(error.message);
      return { deleted: event_id };
    },
  );

  tool(
    "create_reminder",
    "Schedule a reminder to be delivered over iMessage at fire_at. Delivered to the given chat_guid's channel, or the household's first channel by default. Optionally link it to a task or event.",
    z.object({
      household_id: z.string().uuid(),
      message: z.string().min(1).describe("The reminder text that will be sent"),
      fire_at: iso("When to deliver"),
      chat_guid: z.string().optional().describe("Deliver to this chat instead of the household default"),
      member_id: z.string().uuid().optional().describe("Member the reminder is for"),
      task_id: z.string().uuid().optional(),
      event_id: z.string().uuid().optional(),
    }),
    async (args, db, userId) => {
      const [createdBy, channelId] = await Promise.all([
        callerMemberId(db, args.household_id, userId),
        defaultChannelId(db, args.household_id, args.chat_guid),
      ]);
      if (args.chat_guid && !channelId) throw new Error(`no channel with chat_guid ${args.chat_guid} in this household`);
      const { data, error } = await db
        .from("reminders")
        .insert({
          household_id: args.household_id,
          message: args.message,
          fire_at: args.fire_at,
          channel_id: channelId,
          member_id: args.member_id ?? null,
          task_id: args.task_id ?? null,
          event_id: args.event_id ?? null,
          created_by: createdBy,
        })
        .select("id, message, fire_at, status")
        .single();
      if (error) throw new Error(error.message);
      return { ...data, delivery: channelId ? "imessage" : "portal-only (no channel mapped)" };
    },
  );

  tool(
    "list_reminders",
    "List reminders. Defaults to pending ones.",
    z.object({
      household_id: z.string().uuid(),
      status: z.enum(["pending", "sent", "cancelled", "all"]).optional(),
    }),
    async (args, db) => {
      let q = db
        .from("reminders")
        .select("id, message, fire_at, status, sent_at, member_id, task_id, event_id")
        .eq("household_id", args.household_id)
        .order("fire_at");
      const status = args.status ?? "pending";
      if (status !== "all") q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data;
    },
  );

  tool(
    "cancel_reminder",
    "Cancel a pending reminder.",
    z.object({ reminder_id: z.string().uuid() }),
    async ({ reminder_id }, db) => {
      const { data, error } = await db
        .from("reminders")
        .update({ status: "cancelled" })
        .eq("id", reminder_id)
        .eq("status", "pending")
        .select("id, status")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
  );
}

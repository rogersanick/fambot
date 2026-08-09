"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

/** datetime-local inputs have no timezone; interpret them in the household's tz. */
function localToIso(value: string, timeZone: string): string | null {
  if (!value) return null;
  // Find the UTC instant whose wall-clock time in `timeZone` matches `value`.
  const [date, time] = value.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  let guess = Date.UTC(y, m - 1, d, hh, mm);
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
    const want = Date.UTC(y, m - 1, d, hh, mm);
    if (rendered === want) break;
    guess += want - rendered;
  }
  return new Date(guess).toISOString();
}

async function db() {
  return createClient();
}

export async function createTask(householdId: string, timezone: string, fd: FormData) {
  const title = str(fd, "title");
  if (!title) return;
  const supabase = await db();
  const assignee = str(fd, "assignee_id");
  await supabase.from("tasks").insert({
    household_id: householdId,
    title,
    assignee_id: assignee || null,
    due_at: localToIso(str(fd, "due_at"), timezone),
  });
  revalidatePath(`/h/${householdId}`);
}

export async function setTaskStatus(householdId: string, taskId: string, status: "open" | "done" | "cancelled") {
  const supabase = await db();
  await supabase
    .from("tasks")
    .update({ status, completed_at: status === "done" ? new Date().toISOString() : null })
    .eq("id", taskId);
  revalidatePath(`/h/${householdId}`);
}

export async function createEvent(householdId: string, timezone: string, fd: FormData) {
  const title = str(fd, "title");
  const startsAt = localToIso(str(fd, "starts_at"), timezone);
  if (!title || !startsAt) return;
  const supabase = await db();
  await supabase.from("events").insert({
    household_id: householdId,
    title,
    starts_at: startsAt,
    ends_at: localToIso(str(fd, "ends_at"), timezone),
    location: str(fd, "location") || null,
  });
  revalidatePath(`/h/${householdId}`);
}

export async function deleteEvent(householdId: string, eventId: string) {
  const supabase = await db();
  await supabase.from("events").delete().eq("id", eventId);
  revalidatePath(`/h/${householdId}`);
}

export async function createReminder(householdId: string, timezone: string, fd: FormData) {
  const message = str(fd, "message");
  const fireAt = localToIso(str(fd, "fire_at"), timezone);
  if (!message || !fireAt) return;
  const supabase = await db();
  const { data: channel } = await supabase
    .from("channels")
    .select("id")
    .eq("household_id", householdId)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  await supabase.from("reminders").insert({
    household_id: householdId,
    message,
    fire_at: fireAt,
    channel_id: channel?.id ?? null,
  });
  revalidatePath(`/h/${householdId}`);
}

export async function cancelReminder(householdId: string, reminderId: string) {
  const supabase = await db();
  await supabase.from("reminders").update({ status: "cancelled" }).eq("id", reminderId).eq("status", "pending");
  revalidatePath(`/h/${householdId}`);
}

export async function addMember(householdId: string, fd: FormData) {
  const displayName = str(fd, "display_name");
  if (!displayName) return;
  const supabase = await db();
  const handle = str(fd, "handle").toLowerCase();
  const email = str(fd, "email").toLowerCase();
  if (email) {
    // Links an existing account (family member's login, or the agent user).
    await supabase.rpc("add_member_with_email", {
      p_household_id: householdId,
      p_display_name: displayName,
      p_email: email,
      p_role: email.startsWith("agent@") ? "agent" : "member",
      p_handle: handle || undefined,
    });
  } else {
    await supabase.from("members").insert({
      household_id: householdId,
      display_name: displayName,
      handle: handle || null,
    });
  }
  revalidatePath(`/h/${householdId}`);
}

export async function addChannel(householdId: string, fd: FormData) {
  const chatGuid = str(fd, "chat_guid");
  if (!chatGuid) return;
  const supabase = await db();
  await supabase.from("channels").insert({
    household_id: householdId,
    chat_guid: chatGuid,
    name: str(fd, "name") || null,
  });
  revalidatePath(`/h/${householdId}`);
}

export async function updateHousehold(householdId: string, fd: FormData) {
  const supabase = await db();
  const name = str(fd, "name");
  const timezone = str(fd, "timezone");
  if (!name || !timezone) return;
  await supabase.from("households").update({ name, timezone }).eq("id", householdId);
  revalidatePath(`/h/${householdId}`);
}

export async function signOut() {
  const supabase = await db();
  await supabase.auth.signOut();
  redirect("/login");
}

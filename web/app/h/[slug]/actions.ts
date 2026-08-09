"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

type TaskUpdate = Database["public"]["Tables"]["tasks"]["Update"];
type EventUpdate = Database["public"]["Tables"]["events"]["Update"];

/** All mutations run under RLS as the signed-in user; the audit trigger
 *  attributes them through auth.uid() → member_links. */

export async function setTaskStatus(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const id = String(formData.get("task_id"));
  const slug = String(formData.get("slug"));
  const status = String(formData.get("status"));

  const patch: TaskUpdate = { status };
  if (status === "done") patch.completed_at = new Date().toISOString();
  if (status === "cancelled") patch.cancelled_at = new Date().toISOString();
  if (status === "open") {
    patch.completed_at = null;
    patch.cancelled_at = null;
  }

  await supabase.from("tasks").update(patch).eq("id", id);
  revalidatePath(`/h/${slug}`, "layout");
}

export async function updateTask(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const id = String(formData.get("task_id"));
  const slug = String(formData.get("slug"));
  const code = String(formData.get("code"));

  const title = String(formData.get("title") ?? "").trim();
  const assignee = String(formData.get("assignee_member_id") ?? "");
  const dueLocal = String(formData.get("due_at") ?? "").trim();

  const patch: TaskUpdate = {
    assignee_member_id: assignee === "" || assignee === "none" ? null : assignee,
    due_at: dueLocal ? new Date(dueLocal).toISOString() : null,
  };
  if (title) patch.title = title;

  await supabase.from("tasks").update(patch).eq("id", id);
  revalidatePath(`/h/${slug}/k/${code}`);
  redirect(`/h/${slug}/k/${code}`);
}

export async function updateEvent(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const id = String(formData.get("event_id"));
  const slug = String(formData.get("slug"));

  const title = String(formData.get("title") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const startsLocal = String(formData.get("starts_at") ?? "").trim();
  const endsLocal = String(formData.get("ends_at") ?? "").trim();
  const status = String(formData.get("status") ?? "");

  const patch: EventUpdate = {
    location: location || null,
    ends_at: endsLocal ? new Date(endsLocal).toISOString() : null,
  };
  if (title) patch.title = title;
  if (startsLocal) patch.starts_at = new Date(startsLocal).toISOString();
  if (status === "active" || status === "cancelled") patch.status = status;

  await supabase.from("events").update(patch).eq("id", id);
  revalidatePath(`/h/${slug}/calendar`);
  redirect(`/h/${slug}/calendar`);
}

export async function saveSettings(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const slug = String(formData.get("slug"));
  const householdId = String(formData.get("household_id"));

  const opt = (name: string) => {
    const v = String(formData.get(name) ?? "").trim();
    return v === "" ? null : v;
  };

  const { error } = await supabase.rpc("update_household_settings", {
    p_household_id: householdId,
    p_display_name: opt("display_name") ?? undefined,
    p_invocation_name: opt("invocation_name") ?? undefined,
    p_timezone: opt("timezone") ?? undefined,
    p_quiet_hours_start: opt("quiet_hours_start") ?? undefined,
    p_quiet_hours_end: opt("quiet_hours_end") ?? undefined,
    p_morning_default: opt("morning_default") ?? undefined,
    p_afternoon_default: opt("afternoon_default") ?? undefined,
    p_evening_default: opt("evening_default") ?? undefined,
    p_before_event_offset_minutes: opt("before_event_offset_minutes")
      ? Number(opt("before_event_offset_minutes"))
      : undefined,
  });

  revalidatePath(`/h/${slug}/settings`);
  redirect(`/h/${slug}/settings${error ? "?error=" + encodeURIComponent(error.message) : "?saved=1"}`);
}

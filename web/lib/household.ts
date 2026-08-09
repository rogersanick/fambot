import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface Household {
  id: string;
  slug: string;
  display_name: string | null;
  invocation_name: string;
  timezone: string | null;
  state: string;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  morning_default: string;
  afternoon_default: string;
  evening_default: string;
  before_event_offset_minutes: number;
}

/** RLS is the tenant boundary: an unlinked user simply gets no row → 404. */
export async function getHousehold(slug: string): Promise<Household> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("households")
    .select(
      "id, slug, display_name, invocation_name, timezone, state, quiet_hours_start, quiet_hours_end, morning_default, afternoon_default, evening_default, before_event_offset_minutes",
    )
    .eq("slug", slug)
    .maybeSingle();
  if (!data) notFound();
  return data as Household;
}

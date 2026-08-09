import { getHousehold } from "@/lib/household";
import { createClient } from "@/lib/supabase/server";
import { saveSettings } from "../actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const household = await getHousehold(slug);
  const supabase = await createClient();

  const { data: members } = await supabase
    .from("members")
    .select("id, display_name, normalized_handle, aliases")
    .is("removed_at", null)
    .order("joined_at");

  const t = (v: string | null) => (v ? v.slice(0, 5) : "");

  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>

      {sp.saved && <p className="text-sm text-green-600">Settings saved.</p>}
      {sp.error && <p className="text-sm text-destructive">Couldn&apos;t save: {sp.error}</p>}

      <form action={saveSettings} className="grid gap-6">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="household_id" value={household.id} />

        <Card>
          <CardHeader>
            <CardTitle>Household</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="display_name">Name</Label>
              <Input id="display_name" name="display_name" defaultValue={household.display_name ?? ""} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="invocation_name">Bot name</Label>
              <Input id="invocation_name" name="invocation_name" defaultValue={household.invocation_name} />
              <p className="text-xs text-muted-foreground">
                One word, 2–20 letters. &quot;fambot&quot; always works too.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="timezone">Timezone (IANA)</Label>
              <Input id="timezone" name="timezone" defaultValue={household.timezone ?? ""} placeholder="America/New_York" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Times</CardTitle>
            <CardDescription>
              Named defaults used when someone says &quot;morning&quot;, &quot;afternoon&quot;, or
              &quot;evening&quot;. Quiet hours defer reminders until they end.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="morning_default">Morning</Label>
              <Input id="morning_default" name="morning_default" type="time" defaultValue={t(household.morning_default)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="afternoon_default">Afternoon</Label>
              <Input id="afternoon_default" name="afternoon_default" type="time" defaultValue={t(household.afternoon_default)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="evening_default">Evening</Label>
              <Input id="evening_default" name="evening_default" type="time" defaultValue={t(household.evening_default)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="quiet_hours_start">Quiet hours start</Label>
              <Input id="quiet_hours_start" name="quiet_hours_start" type="time" defaultValue={t(household.quiet_hours_start)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="quiet_hours_end">Quiet hours end</Label>
              <Input id="quiet_hours_end" name="quiet_hours_end" type="time" defaultValue={t(household.quiet_hours_end)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="before_event_offset_minutes">Event reminder (min before)</Label>
              <Input
                id="before_event_offset_minutes"
                name="before_event_offset_minutes"
                type="number"
                min={0}
                defaultValue={household.before_event_offset_minutes}
              />
            </div>
          </CardContent>
        </Card>

        <Button type="submit" className="justify-self-start">
          Save settings
        </Button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            Seeded from the group chat. Aliases are set by telling the bot (e.g. &quot;call Jessica Jess&quot;).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {(members ?? []).map((m) => (
            <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <span className="font-medium">{m.display_name ?? m.normalized_handle}</span>
              <span className="text-muted-foreground">{m.normalized_handle}</span>
              {(m.aliases ?? []).map((a: string) => (
                <Badge key={a} variant="outline">{a}</Badge>
              ))}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Channels</CardTitle>
          <CardDescription>Where the bot listens. Managed from the chat, read-only here.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChannelList householdId={household.id} />
        </CardContent>
      </Card>
    </div>
  );
}

async function ChannelList({ householdId }: { householdId: string }) {
  // Channels are a transport table with no portal RLS policies by design;
  // show the single connected-chat fact from what the household can know.
  void householdId;
  return (
    <p className="text-sm text-muted-foreground">
      One iMessage group chat is connected. Tag the bot there to manage everything.
    </p>
  );
}

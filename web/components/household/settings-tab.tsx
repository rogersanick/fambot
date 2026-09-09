import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SubmitButton } from "@/components/submit-button";
import { MemberAvatar } from "./member-avatar";
import { addChannel, addMember, updateHousehold } from "@/app/h/[id]/actions";
import type { ChannelRow, MemberRow } from "./types";

export function SettingsTab({
  householdId,
  householdName,
  tz,
  members,
  channels,
}: {
  householdId: string;
  householdName: string;
  tz: string;
  members: MemberRow[];
  channels: ChannelRow[];
}) {
  return (
    <div className="grid gap-4">
      <Card className="animate-fade-up">
        <CardHeader>
          <CardTitle className="font-serif text-lg">Household</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updateHousehold.bind(null, householdId)} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Input name="name" defaultValue={householdName} required />
            <Input name="timezone" defaultValue={tz} required />
            <SubmitButton variant="outline">Save</SubmitButton>
          </form>
        </CardContent>
      </Card>

      <Card className="animate-fade-up" style={{ animationDelay: "80ms" }}>
        <CardHeader>
          <CardTitle className="font-serif text-lg">Members</CardTitle>
          <CardDescription>
            The handle is how FamBot recognizes who&apos;s texting: a phone in E.164 form
            (+15551234567) or an email.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="stagger-children grid gap-2 sm:grid-cols-2">
            {members.map((m) => (
              <div key={m.id} className="border-border/70 flex items-center gap-3 rounded-lg border p-3">
                <MemberAvatar name={m.display_name} size="default" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.display_name}</p>
                  {m.handle && <p className="text-muted-foreground truncate font-mono text-xs">{m.handle}</p>}
                </div>
                <Badge variant={m.role === "agent" ? "default" : "secondary"}>{m.role}</Badge>
              </div>
            ))}
          </div>
          <Separator />
          <form action={addMember.bind(null, householdId)} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <Input name="display_name" placeholder="Name" required />
            <Input name="handle" placeholder="+15551234567" />
            <Input name="email" placeholder="Account email (optional)" type="email" />
            <SubmitButton variant="outline">Add member</SubmitButton>
          </form>
          <p className="text-muted-foreground text-xs">
            Provide an account email to link a login — use your agent&apos;s email (e.g.{" "}
            <span className="font-mono">agent@fambot.local</span>) to give FamBot access to this
            household.
          </p>
        </CardContent>
      </Card>

      <Card className="animate-fade-up" style={{ animationDelay: "160ms" }}>
        <CardHeader>
          <CardTitle className="font-serif text-lg">iMessage channels</CardTitle>
          <CardDescription>
            Chats mapped to this household. Find a chat&apos;s GUID with{" "}
            <span className="font-mono text-xs">imsg chats --limit 20</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-1">
            {channels.length === 0 && (
              <p className="text-muted-foreground text-sm">
                No chats mapped yet — reminders stay portal-only until one is.
              </p>
            )}
            {channels.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-2 py-1">
                <span className="flex-1 text-sm">{c.name ?? "Unnamed chat"}</span>
                <span className="text-muted-foreground font-mono text-xs">{c.chat_guid}</span>
              </div>
            ))}
          </div>
          <Separator />
          <form action={addChannel.bind(null, householdId)} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Input name="chat_guid" placeholder="iMessage;+;chat123..." required />
            <Input name="name" placeholder="Family group chat" />
            <SubmitButton variant="outline">Map chat</SubmitButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

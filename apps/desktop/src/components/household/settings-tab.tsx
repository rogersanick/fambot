import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SubmitButton } from "@/components/submit-button";
import { MemberAvatar } from "./member-avatar";
import { api, type BridgeStatus } from "@/lib/api";
import { useAction } from "./use-actions";
import type { MemberRow } from "./types";

export function SettingsTab({
  householdId,
  householdName,
  tz,
  members,
  bridge,
}: {
  householdId: string;
  householdName: string;
  tz: string;
  members: MemberRow[];
  bridge: BridgeStatus;
}) {
  const save = useAction(householdId);
  const addMember = useAction(householdId);

  return (
    <div className="grid gap-4">
      <Card className="animate-fade-up">
        <CardHeader>
          <CardTitle className="font-serif text-lg">Household</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const name = String(fd.get("name") ?? "").trim();
              const timezone = String(fd.get("timezone") ?? "").trim();
              if (!name || !timezone) return;
              void save.run(() => api.updateHousehold(householdId, { name, timezone }));
            }}
            className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
          >
            <Input name="name" defaultValue={householdName} required />
            <Input name="timezone" defaultValue={tz} required />
            <SubmitButton variant="outline" pending={save.pending}>
              Save
            </SubmitButton>
          </form>
        </CardContent>
      </Card>

      <Card className="animate-fade-up" style={{ animationDelay: "80ms" }}>
        <CardHeader>
          <CardTitle className="font-serif text-lg">Members</CardTitle>
          <CardDescription>
            The handle is how FamBot recognizes who&apos;s texting: a phone in E.164 form
            (+15551234567) or an iMessage email.
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
                <Badge variant="secondary">{m.role}</Badge>
              </div>
            ))}
          </div>
          <Separator />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const fd = new FormData(form);
              const displayName = String(fd.get("display_name") ?? "").trim();
              if (!displayName) return;
              void addMember
                .run(() =>
                  api.addMember(householdId, {
                    displayName,
                    imessageHandle: String(fd.get("handle") ?? "").trim() || undefined,
                  })
                )
                .then((ok) => ok && form.reset());
            }}
            className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
          >
            <Input name="display_name" placeholder="Name" required />
            <Input name="handle" placeholder="+15551234567" />
            <SubmitButton variant="outline" pending={addMember.pending}>
              Add member
            </SubmitButton>
          </form>
          <p className="text-muted-foreground text-xs">
            Members with an iMessage handle can talk to FamBot by texting — their chats map to this
            household automatically.
          </p>
        </CardContent>
      </Card>

      <Card className="animate-fade-up" style={{ animationDelay: "160ms" }}>
        <CardHeader>
          <CardTitle className="font-serif text-lg">iMessage bridge</CardTitle>
          <CardDescription>
            The Mac relay that connects FamBot to iMessage. Conversations are mapped automatically
            when a known member texts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <span
              className={
                "h-2.5 w-2.5 rounded-full " + (bridge.connected ? "bg-chart-1 animate-gentle-pulse" : "bg-destructive")
              }
              aria-hidden
            />
            <span className="text-sm">{bridge.connected ? "Connected" : "Offline"}</span>
            {bridge.lastSeen && (
              <span className="text-muted-foreground text-xs">
                last seen {new Date(bridge.lastSeen).toLocaleString()}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

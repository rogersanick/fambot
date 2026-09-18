import { useState } from "react";
import { normalizePhone, formatPhone } from "@fambot/shared/phone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { SubmitButton } from "@/components/submit-button";
import { TimezoneSelect } from "@/components/timezone-select";
import { PhoneInput } from "@/components/phone-input";
import { MemberAvatar } from "./member-avatar";
import { api } from "@/lib/api";
import { useAction } from "./use-actions";
import { toast } from "sonner";
import type { MemberRow } from "./types";

export function SettingsTab({
  householdId,
  householdName,
  tz,
  meId,
  members,
}: {
  householdId: string;
  householdName: string;
  tz: string;
  meId: string;
  members: MemberRow[];
}) {
  const save = useAction(householdId);
  const inviteMember = useAction(householdId);
  const me = members.find((member) => member.id === meId);
  const isOwner = me?.role === "owner";

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
            <TimezoneSelect defaultValue={tz} />
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
            Every member needs a phone number — texts are the default way Fambot delivers reminders
            and task nudges. The iMessage handle is separate and optional (a number or Apple ID email).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="stagger-children grid gap-2">
            {members.map((m) => (
              <MemberIdentityRow
                key={m.id}
                householdId={householdId}
                member={m}
                editable={isOwner || m.id === meId}
                isOwner={isOwner}
              />
            ))}
          </div>
          {isOwner && (
            <>
              <Separator />
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const fd = new FormData(form);
                  const displayName = String(fd.get("display_name") ?? "").trim();
                  const phone = normalizePhone(String(fd.get("phone") ?? ""));
                  if (!displayName) return;
                  if (!phone || !/^\+1\d{10}$/.test(phone)) {
                    toast.error("Group texting requires a US or Canadian phone number.");
                    return;
                  }
                  let smsFailed = false;
                  let sendError: string | null = null;
                  void inviteMember
                    .run(async () => {
                      const result = await api.createInvite(householdId, { displayName, phone });
                      smsFailed = result.invite.smsStatus === "failed";
                      sendError = result.invite.sendError;
                    })
                    .then((ok) => {
                      if (ok) {
                        form.reset();
                        if (smsFailed) {
                          toast.error(
                            sendError
                              ? `Member created, but the invite text failed: ${sendError}`
                              : "Member created, but the invite text failed. Use Resend to try again."
                          );
                        } else {
                          toast.success(`Invite text sent to ${formatPhone(phone)}`);
                        }
                      }
                    });
                }}
                className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
              >
                <Input name="display_name" placeholder="Name" required />
                <PhoneInput name="phone" placeholder="US/Canada phone" />
                <SubmitButton variant="outline" pending={inviteMember.pending}>
                  Invite member
                </SubmitButton>
              </form>
            </>
          )}
          <p className="text-muted-foreground text-xs">
            Invite links expire after 7 days. With two or more members, Fambot accepts direct or group
            texts and replies in the household group MMS (up to 8 members).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function MemberIdentityRow({
  householdId,
  member,
  editable,
  isOwner,
}: {
  householdId: string;
  member: MemberRow;
  editable: boolean;
  isOwner: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [usePhoneForImessage, setUsePhoneForImessage] = useState(
    Boolean(member.phone && member.handle === member.phone)
  );
  const action = useAction(householdId);

  return (
    <div className="border-border/70 rounded-lg border p-3">
      <div className="flex items-center gap-3">
        <MemberAvatar name={member.display_name} size="default" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{member.display_name}</p>
          <p className="text-muted-foreground truncate font-mono text-xs">
            {member.phone ? formatPhone(member.phone) : <span className="text-destructive">no phone — notifications skipped</span>}
            {member.handle && <span> · iMessage: {member.handle}</span>}
          </p>
        </div>
        <Badge variant="secondary">{member.role}</Badge>
        {member.user_id ? (
          <Badge variant="outline">account linked</Badge>
        ) : member.invite ? (
          <Badge variant={member.invite.smsStatus === "failed" ? "destructive" : "outline"}>
            {member.invite.smsStatus === "failed"
              ? "SMS failed"
              : member.invite.state === "expired"
                ? "invite expired"
                : "invite pending"}
          </Badge>
        ) : (
          <Badge variant="outline">phone only</Badge>
        )}
        {isOwner && member.invite && member.invite.state !== "accepted" && (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={action.pending}
              onClick={() =>
                void action.run(() => api.resendInvite(householdId, member.invite!.id))
              }
            >
              Resend
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={action.pending}
              onClick={() =>
                void action.run(() => api.cancelInvite(householdId, member.invite!.id))
              }
            >
              Cancel
            </Button>
          </>
        )}
        {editable && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setEditing((open) => {
                if (!open) {
                  setUsePhoneForImessage(Boolean(member.phone && member.handle === member.phone));
                }
                return !open;
              })
            }
          >
            {editing ? "Close" : "Edit"}
          </Button>
        )}
      </div>
      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const rawPhone = String(fd.get("phone") ?? "").trim();
            const phone = rawPhone ? normalizePhone(rawPhone) : null;
            if (rawPhone && !phone) {
              toast.error("Enter a valid phone number");
              return;
            }
            if (usePhoneForImessage && !phone) {
              toast.error("Add a valid phone number before enabling it for iMessage");
              return;
            }
            const rawHandle = String(fd.get("handle") ?? "").trim();
            const handle = usePhoneForImessage
              ? phone!
              : rawHandle
                ? (normalizePhone(rawHandle) ?? rawHandle.toLowerCase())
                : "";
            void action
              .run(async () => {
                if (phone && phone !== member.phone) {
                  await api.setMemberPhone(householdId, member.id, phone);
                }
                if (handle !== (member.handle ?? "")) {
                  await api.setMemberImessage(householdId, member.id, handle || null);
                }
              })
              .then((ok) => ok && setEditing(false));
          }}
          className="mt-3 grid gap-3"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <PhoneInput name="phone" defaultValue={member.phone ?? ""} placeholder="Phone (SMS)" />
              <p className="text-muted-foreground text-xs">US numbers may omit +1.</p>
            </div>
            <div className="grid gap-1">
              <Input
                name="handle"
                defaultValue={
                  member.handle && member.handle !== member.phone ? member.handle : ""
                }
                placeholder="Apple ID email or alternate iMessage number"
                disabled={usePhoneForImessage}
              />
              <p className="text-muted-foreground text-xs">
                {usePhoneForImessage ? "Using the phone number entered here." : "Optional Apple ID or alternate number."}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Use phone number for iMessage</p>
              <p className="text-muted-foreground text-xs">
                Match incoming iMessages from this member to their phone number.
              </p>
            </div>
            <Switch
              checked={usePhoneForImessage}
              onCheckedChange={setUsePhoneForImessage}
              aria-label={`Use ${member.display_name}'s phone number for iMessage`}
            />
          </div>
          <SubmitButton className="justify-self-end" variant="outline" pending={action.pending}>
            Save
          </SubmitButton>
        </form>
      )}
    </div>
  );
}

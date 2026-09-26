import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import {
  disablePush,
  enablePush,
  installationId,
  isTauri,
  pushPermissionState,
  sendLocalTestNotification,
  type PushState,
} from "@/lib/notifications";
import type { MemberRow } from "./types";
import { toast } from "sonner";

/**
 * Household notification settings. Scheduled reminders and task nudges
 * broadcast to every enabled channel here — SMS by default, iMessage opt-in.
 * Web chat is an interaction surface only, never a notification destination.
 */
export function ConnectionsTab({
  householdId,
  isOwner,
  members,
}: {
  householdId: string;
  isOwner: boolean;
  members: MemberRow[];
}) {
  const queryClient = useQueryClient();
  const channelsQuery = useQuery({
    queryKey: ["notification-channels", householdId],
    queryFn: () => api.notificationChannels.get(householdId),
    refetchInterval: 15_000,
  });
  const integrations = useQuery({
    queryKey: ["integrations"],
    queryFn: api.integrations.get,
    refetchInterval: 15_000,
  });

  const data = channelsQuery.data;
  const smsChannel = data?.channels.find((c) => c.channel === "sms");
  const imsgChannel = data?.channels.find((c) => c.channel === "imessage");
  const pushChannel = data?.channels.find((c) => c.channel === "push");
  const google = integrations.data?.google;

  const withPhone = members.filter((m) => m.phone);
  const missingPhone = members.filter((m) => !m.phone);

  const [devicePush, setDevicePush] = useState<PushState>("unsupported");
  const [pushBusy, setPushBusy] = useState(false);
  useEffect(() => {
    void pushPermissionState().then(setDevicePush);
  }, []);

  const memberName = new Map(members.map((m) => [m.id, m.display_name]));
  const thisInstallation = isTauri() ? installationId() : null;
  const activeDevices = (data?.push.devices ?? []).filter((d) => d.active);

  async function enableThisDevice() {
    setPushBusy(true);
    try {
      const state = await enablePush(householdId);
      setDevicePush(state);
      if (state === "registered") toast.success("This device will now receive Fambot alerts.");
      else if (state === "denied")
        toast.error("Notifications are blocked. Allow them in iOS Settings → Fambot.");
      else toast.error("Push isn't available on this device.");
      await queryClient.invalidateQueries({ queryKey: ["notification-channels", householdId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't enable notifications");
    } finally {
      setPushBusy(false);
    }
  }

  async function disableThisDevice() {
    setPushBusy(true);
    try {
      await disablePush(householdId);
      setDevicePush("prompt");
      await queryClient.invalidateQueries({ queryKey: ["notification-channels", householdId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't disable notifications");
    } finally {
      setPushBusy(false);
    }
  }

  async function sendTestPush() {
    setPushBusy(true);
    try {
      if (!data?.push.configured) {
        // No APNs on the server yet — still verify OS-level presentation.
        await sendLocalTestNotification();
        toast.success("Local test notification sent.");
        return;
      }
      const { sent, errors } = await api.pushDevices.test(householdId);
      if (sent > 0) toast.success(`Test push sent to ${sent} device${sent === 1 ? "" : "s"}.`);
      if (errors.length > 0) toast.error(errors.join("; "));
      if (sent === 0 && errors.length === 0) toast("No registered devices to push to.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test push failed");
    } finally {
      setPushBusy(false);
    }
  }

  async function setChannel(
    channel: "sms" | "imessage" | "push",
    enabled: boolean,
    conversationId?: string | null
  ) {
    try {
      await api.notificationChannels.update(householdId, { channel, enabled, conversationId });
      await queryClient.invalidateQueries({ queryKey: ["notification-channels", householdId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update the channel");
    }
  }

  async function connectGoogle() {
    try {
      const { url } = await api.integrations.googleConnect();
      window.location.assign(url);
    } catch {
      toast.error("Google OAuth isn't configured on the server yet.");
    }
  }

  async function disconnectGoogle() {
    await api.integrations.googleDisconnect();
    await queryClient.invalidateQueries({ queryKey: ["integrations"] });
  }

  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground text-sm">
        Reminders and task nudges are sent to <span className="text-foreground">every enabled channel</span> below.
        They never appear in the in-app chat — that's only for talking to Fambot.
      </p>

      <Card className="animate-fade-up">
        <CardHeader>
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="font-serif text-lg">Text messages (SMS)</CardTitle>
              <CardDescription>
                The default channel. Each member gets notifications at their own number and can reply
                (e.g. &quot;done&quot;) to talk back to Fambot.
              </CardDescription>
            </div>
            <Switch
              checked={smsChannel?.enabled ?? false}
              disabled={!isOwner || !smsChannel}
              onCheckedChange={(v) => void setChannel("sms", v)}
              aria-label="Enable SMS notifications"
              className="self-start sm:self-auto"
            />
          </div>
        </CardHeader>
        <CardContent className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {data?.sms.configured ? (
              <>
                <Badge className="bg-chart-1 text-primary-foreground">provider ready</Badge>
                {data.sms.fromNumber && (
                  <span className="text-muted-foreground font-mono text-xs">sends from {data.sms.fromNumber}</span>
                )}
              </>
            ) : (
              <>
                <Badge variant="outline">provider not configured</Badge>
                <span className="text-muted-foreground text-xs">
                  {data?.sms.apiKeySet
                    ? "Telnyx API key is set, but no messaging number was found. Buy a US/Canada long-code number, attach it to a Messaging Profile, then restart bun dev."
                    : "Set TELNYX_API_KEY on the API. bun dev discovers the number and starts a Cloudflare webhook tunnel."}
                </span>
              </>
            )}
          </div>
          {data?.sms.configured && data.sms.inboundReady === false && (
            <p className="text-muted-foreground text-xs">
              Outbound can send, but inbound replies need a public webhook. Restart{" "}
              <code>bun dev</code> (it prefers ngrok) or run{" "}
              <code>ngrok http 8787</code>.
            </p>
          )}
          <p className="text-sm">
            {withPhone.length} of {members.length} member{members.length === 1 ? "" : "s"} have a phone number.
          </p>
          {missingPhone.length > 0 && (
            <p className="text-destructive text-xs">
              Missing numbers: {missingPhone.map((m) => m.display_name).join(", ")} — add them in Settings or
              their notifications will be skipped.
            </p>
          )}
          {!isOwner && <p className="text-muted-foreground text-xs">Only the household owner can change channels.</p>}
        </CardContent>
      </Card>

      <Card className="animate-fade-up" style={{ animationDelay: "80ms" }}>
        <CardHeader>
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="font-serif text-lg">iMessage</CardTitle>
              <CardDescription>
                Optional. Delivers notifications into an iMessage conversation through the relay running on
                your Mac.
              </CardDescription>
            </div>
            <Switch
              checked={imsgChannel?.enabled ?? false}
              disabled={!isOwner || !imsgChannel}
              onCheckedChange={(v) => void setChannel("imessage", v)}
              aria-label="Enable iMessage notifications"
              className="self-start sm:self-auto"
            />
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex items-center gap-3">
            <span
              className={
                "h-2.5 w-2.5 rounded-full " +
                (data?.bridge.connected ? "bg-chart-1 animate-gentle-pulse" : "bg-destructive")
              }
              aria-hidden
            />
            <span className="text-sm">Mac bridge: {data?.bridge.connected ? "connected" : "offline"}</span>
            {data?.bridge.lastSeen && (
              <span className="text-muted-foreground text-xs">
                last seen {new Date(data.bridge.lastSeen).toLocaleString()}
              </span>
            )}
          </div>
          <div className="grid gap-1">
            <p className="text-muted-foreground text-xs">Deliver notifications into this conversation:</p>
            <Select
              value={imsgChannel?.conversationId ?? ""}
              disabled={!isOwner || (data?.imessageConversations.length ?? 0) === 0}
              onValueChange={(v) => void setChannel("imessage", imsgChannel?.enabled ?? false, v || null)}
            >
              <SelectTrigger className="w-full sm:w-80">
                <SelectValue
                  placeholder={
                    (data?.imessageConversations.length ?? 0) === 0
                      ? "No iMessage conversations yet — text Fambot first"
                      : "Choose a conversation"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {data?.imessageConversations.map((conv) => (
                  <SelectItem key={conv.id} value={conv.id}>
                    {conv.name ?? "iMessage conversation"} {conv.kind === "group" ? "(group)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="animate-fade-up" style={{ animationDelay: "120ms" }}>
        <CardHeader>
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="font-serif text-lg">iPhone app alerts</CardTitle>
              <CardDescription>
                Native push notifications from the Fambot app. Each member enables it on their own
                phone; this switch turns the channel on or off for the whole household.
              </CardDescription>
            </div>
            <Switch
              checked={pushChannel?.enabled ?? false}
              disabled={!isOwner || !pushChannel}
              onCheckedChange={(v) => void setChannel("push", v)}
              aria-label="Enable app push notifications"
              className="self-start sm:self-auto"
            />
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {data?.push.configured ? (
              <Badge className="bg-chart-1 text-primary-foreground">APNs ready</Badge>
            ) : (
              <>
                <Badge variant="outline">APNs not configured</Badge>
                <span className="text-muted-foreground text-xs">
                  Set APNS_TEAM_ID / APNS_KEY_ID / APNS_BUNDLE_ID / APNS_PRIVATE_KEY on the API and
                  worker to enable.
                </span>
              </>
            )}
          </div>

          {activeDevices.length > 0 ? (
            <div className="grid gap-1">
              {activeDevices.map((d) => (
                <div key={d.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span>{memberName.get(d.memberId) ?? "Member"}</span>
                  <span className="text-muted-foreground font-mono text-xs">
                    {d.platform} · {d.environment}
                    {d.installationId === thisInstallation ? " · this device" : ""}
                  </span>
                  {d.lastSeenAt && (
                    <span className="text-muted-foreground text-xs">
                      seen {new Date(d.lastSeenAt).toLocaleString()}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No phones registered yet.</p>
          )}

          {isTauri() ? (
            <div className="flex flex-wrap gap-2">
              {devicePush === "registered" ? (
                <Button variant="outline" size="sm" disabled={pushBusy} onClick={() => void disableThisDevice()}>
                  Disable on this device
                </Button>
              ) : (
                <Button
                  variant="default"
                  size="sm"
                  disabled={pushBusy || devicePush === "unsupported"}
                  onClick={() => void enableThisDevice()}
                >
                  {devicePush === "denied" ? "Notifications blocked" : "Enable on this device"}
                </Button>
              )}
              <Button variant="outline" size="sm" disabled={pushBusy} onClick={() => void sendTestPush()}>
                {data?.push.configured ? "Send test push" : "Send local test"}
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">
              Open the Fambot iPhone app to enable alerts on a phone. This browser can't receive
              them.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="animate-fade-up" style={{ animationDelay: "160ms" }}>
        <CardHeader>
          <CardTitle className="font-serif text-lg">Google Calendar</CardTitle>
          <CardDescription>
            When connected, events Fambot creates go to your Google Calendar and schedule questions
            merge Google + household events.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          {google?.connected ? (
            <>
              <Badge className="bg-chart-1 text-primary-foreground">connected</Badge>
              {google.email && <span className="text-muted-foreground text-sm">{google.email}</span>}
              <Button variant="outline" size="sm" onClick={disconnectGoogle} className="sm:ml-auto">
                Disconnect
              </Button>
            </>
          ) : (
            <>
              <Badge variant="outline">not connected</Badge>
              {!google?.configured && (
                <span className="text-muted-foreground text-xs">
                  Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET on the API to enable.
                </span>
              )}
              <Button
                variant="default"
                size="sm"
                onClick={connectGoogle}
                disabled={!google?.configured}
                className="sm:ml-auto"
              >
                Connect
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

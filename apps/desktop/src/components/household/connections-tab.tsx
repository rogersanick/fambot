import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, type BridgeStatus } from "@/lib/api";
import { toast } from "sonner";

export function ConnectionsTab({ bridge }: { bridge: BridgeStatus }) {
  const queryClient = useQueryClient();
  const integrations = useQuery({
    queryKey: ["integrations"],
    queryFn: api.integrations.get,
    refetchInterval: 15_000,
  });
  const google = integrations.data?.google;
  const liveBridge = integrations.data?.bridge ?? bridge;

  async function connectGoogle() {
    try {
      const { url } = await api.integrations.googleConnect();
      window.open(url, "_blank");
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
      <Card className="animate-fade-up">
        <CardHeader>
          <CardTitle className="font-serif text-lg">Google Calendar</CardTitle>
          <CardDescription>
            When connected, events Fambot creates go to your Google Calendar and schedule questions
            merge Google + household events.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          {google?.connected ? (
            <>
              <Badge className="bg-chart-1 text-primary-foreground">connected</Badge>
              {google.email && <span className="text-muted-foreground text-sm">{google.email}</span>}
              <Button variant="outline" size="sm" onClick={disconnectGoogle} className="ml-auto">
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
                className="ml-auto"
              >
                Connect
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="animate-fade-up" style={{ animationDelay: "80ms" }}>
        <CardHeader>
          <CardTitle className="font-serif text-lg">iMessage bridge</CardTitle>
          <CardDescription>The relay running on your Mac. Fambot texts through it.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <span
            className={
              "h-2.5 w-2.5 rounded-full " +
              (liveBridge.connected ? "bg-chart-1 animate-gentle-pulse" : "bg-destructive")
            }
            aria-hidden
          />
          <span className="text-sm">{liveBridge.connected ? "Connected" : "Offline"}</span>
          {liveBridge.lastSeen && (
            <span className="text-muted-foreground text-xs">
              last seen {new Date(liveBridge.lastSeen).toLocaleString()}
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

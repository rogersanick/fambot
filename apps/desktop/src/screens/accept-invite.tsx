import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { FambotLogo } from "@/components/robot/logo";
import { RobotSpinner } from "@/components/robot/spinner";
import { api } from "@/lib/api";

export function AcceptInviteScreen({
  token,
  onAccepted,
  onDismiss,
}: {
  token: string;
  onAccepted: (householdId: string) => void;
  onDismiss: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useQuery({
    queryKey: ["invite", token],
    queryFn: () => api.invite(token),
    retry: false,
  });

  async function accept() {
    setPending(true);
    setError(null);
    try {
      const result = await api.acceptInvite(token);
      onAccepted(result.householdId);
    } catch {
      setError("This invite could not be accepted. It may have expired, or this account already belongs to a household.");
    } finally {
      setPending(false);
    }
  }

  const invite = preview.data?.invite;
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <FambotLogo className="text-primary h-10 sm:h-12" />
      <Card className="animate-fade-up w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-serif text-xl">Join the household</CardTitle>
          <CardDescription>
            {preview.isLoading
              ? "Checking your invitation…"
              : invite
                ? `You were invited as ${invite.member.displayName}.`
                : "This invitation is unavailable."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {preview.isLoading && (
            <div className="text-muted-foreground flex items-center gap-2 font-mono text-sm">
              <RobotSpinner /> loading invite…
            </div>
          )}
          {invite && (
            <>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs">Household</p>
                <p className="font-serif text-lg">{invite.household.name}</p>
              </div>
              {invite.state === "pending" ? (
                <SubmitButton type="button" pending={pending} onClick={() => void accept()}>
                  Join household
                </SubmitButton>
              ) : (
                <p className="text-destructive text-sm">
                  This invitation is {invite.state}. Ask the household owner to send a new one.
                </p>
              )}
            </>
          )}
          {(preview.isError || error) && (
            <p className="text-destructive text-sm">
              {error ?? "This invitation is invalid or no longer available."}
            </p>
          )}
          <Button variant="ghost" onClick={onDismiss}>
            Not now
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

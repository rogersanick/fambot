import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "./lib/auth";
import { api } from "./lib/api";
import { LoginScreen } from "./screens/login";
import { OnboardingScreen } from "./screens/onboarding";
import { Dashboard } from "./screens/dashboard";
import { RobotSpinner } from "./components/robot/spinner";
import { AcceptInviteScreen } from "./screens/accept-invite";

export default function App() {
  const [inviteToken, setInviteToken] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get("invite")
  );
  const [selectedHouseholdId, setSelectedHouseholdId] = useState<string | null>(null);
  const { data: session, isPending } = useSession();

  const me = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    enabled: Boolean(session),
  });

  if (isPending || (session && me.isLoading)) {
    return (
      <main className="flex min-h-svh items-center justify-center">
        <div className="text-muted-foreground flex items-center gap-2 font-mono text-sm">
          <RobotSpinner /> booting fambot…
        </div>
      </main>
    );
  }

  if (!session) return <LoginScreen inviteMode={Boolean(inviteToken)} />;

  if (inviteToken) {
    return (
      <AcceptInviteScreen
        token={inviteToken}
        onAccepted={(householdId) => {
          window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
          setInviteToken(null);
          setSelectedHouseholdId(householdId);
          void me.refetch();
        }}
        onDismiss={() => {
          window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
          setInviteToken(null);
        }}
      />
    );
  }

  if (selectedHouseholdId) return <Dashboard householdId={selectedHouseholdId} />;

  const membership = me.data?.memberships[0];
  if (!membership) return <OnboardingScreen onCreated={() => me.refetch()} />;

  return <Dashboard householdId={membership.household.id} />;
}

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { parseArtifactLocation, type ArtifactRef } from "@fambot/shared";
import { useSession } from "./lib/auth";
import { api } from "./lib/api";
import { LoginScreen } from "./screens/login";
import { OnboardingScreen } from "./screens/onboarding";
import { Dashboard } from "./screens/dashboard";
import { ArtifactScreen } from "./screens/artifact";
import { RobotSpinner } from "./components/robot/spinner";
import { AcceptInviteScreen } from "./screens/accept-invite";
import { RobotSceneGallery } from "./components/robot/scenes";

function useArtifactLocation() {
  const [artifact, setArtifact] = useState<ArtifactRef | null>(() =>
    parseArtifactLocation(window.location.pathname)
  );
  useEffect(() => {
    const sync = () => setArtifact(parseArtifactLocation(window.location.pathname));
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  return artifact;
}

export default function App() {
  const [inviteToken, setInviteToken] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get("invite")
  );
  const [selectedHouseholdId, setSelectedHouseholdId] = useState<string | null>(null);
  const artifact = useArtifactLocation();
  const { data: session, isPending } = useSession();

  if (new URLSearchParams(window.location.search).has("scenes")) {
    return (
      <main className="min-h-svh p-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
        <h1 className="font-serif mb-6 text-2xl">Fambot at the Games</h1>
        <RobotSceneGallery />
      </main>
    );
  }

  const me = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    enabled: Boolean(session),
  });

  if (isPending || (session && (me.isLoading || me.isError))) {
    return (
      <main className="flex min-h-svh items-center justify-center">
        <div className="text-muted-foreground flex items-center gap-2 font-mono text-sm">
          <RobotSpinner /> booting fambot…
        </div>
      </main>
    );
  }

  if (!session) return <LoginScreen inviteMode={Boolean(inviteToken)} artifact={artifact} />;

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

  const householdId = selectedHouseholdId ?? me.data?.memberships[0]?.household.id;
  const meName =
    me.data?.memberships.find((row) => row.household.id === householdId)?.member.displayName ??
    me.data?.memberships[0]?.member.displayName ??
    "you";

  if (!householdId) return <OnboardingScreen onCreated={() => me.refetch()} />;

  if (artifact) {
    return <ArtifactScreen householdId={householdId} artifact={artifact} meName={meName} />;
  }

  return <Dashboard householdId={householdId} />;
}

import { useQuery } from "@tanstack/react-query";
import { useSession } from "./lib/auth";
import { api } from "./lib/api";
import { LoginScreen } from "./screens/login";
import { OnboardingScreen } from "./screens/onboarding";
import { Dashboard } from "./screens/dashboard";
import { AsciiSpinner } from "./components/ascii/ascii-spinner";

export default function App() {
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
          <AsciiSpinner /> booting fambot…
        </div>
      </main>
    );
  }

  if (!session) return <LoginScreen />;

  const membership = me.data?.memberships[0];
  if (!membership) return <OnboardingScreen onCreated={() => me.refetch()} />;

  return <Dashboard householdId={membership.household.id} />;
}

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/submit-button";
import { FAMBOT_BANNER } from "@/components/ascii/banner";
import { api } from "@/lib/api";
import { signOut } from "@/lib/auth";
import { Button } from "@/components/ui/button";

const guessTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";

export function OnboardingScreen({ onCreated }: { onCreated: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      await api.createHousehold({
        name: String(fd.get("name") ?? "").trim(),
        timezone: String(fd.get("timezone") ?? "").trim() || guessTz(),
      });
      onCreated();
    } catch {
      setError("Couldn't create the household — try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-6">
      <pre className="text-primary animate-fade-up text-[6px] leading-[1.15] font-bold select-none sm:text-[8px]">
        {FAMBOT_BANNER}
      </pre>
      <Card className="animate-fade-up w-full max-w-sm" style={{ animationDelay: "120ms" }}>
        <CardHeader>
          <CardTitle className="font-serif text-xl">Set up your household</CardTitle>
          <CardDescription>Reminders, todos, and events are shared within it.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Household name</Label>
              <Input id="name" name="name" placeholder="The Rogers" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="timezone">Timezone</Label>
              <Input id="timezone" name="timezone" defaultValue={guessTz()} required />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <SubmitButton pending={pending}>Create household</SubmitButton>
            <Button type="button" variant="ghost" size="sm" onClick={() => signOut()}>
              Sign out
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

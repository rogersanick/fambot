import { useState } from "react";
import { normalizePhone } from "@fambot/shared/phone";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SubmitButton } from "@/components/submit-button";
import { FambotLogo } from "@/components/robot/logo";
import { api } from "@/lib/api";
import { signOut } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { browserTimeZone, TimezoneSelect } from "@/components/timezone-select";
import { PhoneInput } from "@/components/phone-input";

export function OnboardingScreen({ onCreated }: { onCreated: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imessageEnabled, setImessageEnabled] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const ownerPhone = normalizePhone(String(fd.get("phone") ?? ""));
    if (!ownerPhone) {
      setError("Enter a valid 10-digit US phone number or an international number beginning with +.");
      setPending(false);
      return;
    }
    const imessageHandle = String(fd.get("imessage_handle") ?? "").trim();
    try {
      await api.createHousehold({
        name: String(fd.get("name") ?? "").trim(),
        timezone: String(fd.get("timezone") ?? "").trim() || browserTimeZone(),
        ownerPhone,
        usePhoneForImessage: imessageEnabled,
        imessageHandle: imessageEnabled && imessageHandle ? imessageHandle : undefined,
      });
      onCreated();
    } catch {
      setError("Couldn't create the household — try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <FambotLogo className="text-primary animate-fade-up h-10 sm:h-12" />
      <Card className="animate-fade-up w-full max-w-sm" style={{ animationDelay: "120ms" }}>
        <CardHeader>
          <CardTitle className="font-serif text-xl">Set up your household</CardTitle>
          <CardDescription>Reminders, tasks, lists, and events are shared within it.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Household name</Label>
              <Input id="name" name="name" placeholder="The Rogers" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="timezone">Timezone</Label>
              <TimezoneSelect id="timezone" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="phone">Your mobile phone</Label>
              <PhoneInput id="phone" />
              <p className="text-muted-foreground text-xs">
                US numbers may omit +1. Fambot texts your reminders here and recognizes your replies.
              </p>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div className="grid gap-1">
                <Label htmlFor="enable-imessage">Enable iMessage</Label>
                <p className="text-muted-foreground text-xs">
                  Uses your SMS phone number unless you provide another handle.
                </p>
              </div>
              <Switch
                id="enable-imessage"
                checked={imessageEnabled}
                onCheckedChange={setImessageEnabled}
                aria-label="Enable iMessage"
              />
            </div>
            {imessageEnabled && (
              <div className="grid gap-2">
                <Label htmlFor="imessage_handle">Different iMessage handle (optional)</Label>
                <Input
                  id="imessage_handle"
                  name="imessage_handle"
                  placeholder="Apple ID email or another phone number"
                />
                <p className="text-muted-foreground text-xs">
                  Leave blank to use the SMS phone number above.
                </p>
              </div>
            )}
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

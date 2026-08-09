import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; sent?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = params.next ?? "/";

  async function sendMagicLink(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim();
    const nextPath = String(formData.get("next") ?? "/");
    if (!email) redirect(`/login?next=${encodeURIComponent(nextPath)}&error=missing`);

    const supabase = await createClient();
    const base = process.env.NEXT_PUBLIC_APP_BASE_URL ?? "http://localhost:3000";
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${base}/auth/callback?next=${encodeURIComponent(nextPath)}`,
      },
    });
    if (error) redirect(`/login?next=${encodeURIComponent(nextPath)}&error=send`);
    redirect(`/login?next=${encodeURIComponent(nextPath)}&sent=1`);
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to FamBot</CardTitle>
          <CardDescription>
            We&apos;ll email you a magic link — no password needed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {params.sent ? (
            <p className="text-sm text-muted-foreground">
              Check your email for the sign-in link. You can close this tab.
            </p>
          ) : (
            <form action={sendMagicLink} className="grid gap-4">
              <input type="hidden" name="next" value={next} />
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" placeholder="you@example.com" required />
              </div>
              {params.error && (
                <p className="text-sm text-destructive">
                  {params.error === "send" ? "Couldn't send the link — try again." : "Enter your email."}
                </p>
              )}
              <Button type="submit">Send magic link</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

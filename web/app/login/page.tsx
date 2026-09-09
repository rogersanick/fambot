import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/submit-button";
import { Typewriter } from "@/components/ascii/typewriter";
import { FAMBOT_BANNER } from "@/components/ascii/banner";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; mode?: string }>;
}) {
  const params = await searchParams;
  const next = params.next ?? "/";
  const signup = params.mode === "signup";

  async function submit(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const nextPath = String(formData.get("next") ?? "/");
    const mode = String(formData.get("mode") ?? "signin");
    const back = (err: string) =>
      redirect(
        `/login?next=${encodeURIComponent(nextPath)}${mode === "signup" ? "&mode=signup" : ""}&error=${err}`,
      );
    if (!email || !password) back("missing");

    const supabase = await createClient();
    const { error } =
      mode === "signup"
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });
    if (error) back("auth");
    redirect(nextPath);
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-6">
      <div className="animate-fade-up flex flex-col items-center gap-2">
        <pre
          className="text-primary text-[6px] leading-[1.15] font-bold select-none sm:text-[8px]"
          aria-label="FamBot"
          role="img"
        >
          {FAMBOT_BANNER}
        </pre>
        <Typewriter
          lines={["> your household's shared brain"]}
          className="text-muted-foreground text-xs"
          cursorClassName="text-primary"
        />
      </div>
      <Card className="animate-fade-up w-full max-w-sm" style={{ animationDelay: "120ms" }}>
        <CardHeader>
          <CardTitle className="font-serif text-xl">
            {signup ? "Create your FamBot account" : "Sign in to FamBot"}
          </CardTitle>
          <CardDescription>
            {signup ? "One account per family member (and one for your agent)." : "Your household's shared brain."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={submit} className="grid gap-4">
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="mode" value={signup ? "signup" : "signin"} />
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" placeholder="you@example.com" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" required minLength={6} />
            </div>
            {params.error && (
              <p className="text-sm text-destructive">
                {params.error === "auth"
                  ? signup
                    ? "Couldn't create the account — maybe it already exists?"
                    : "Wrong email or password."
                  : "Enter your email and password."}
              </p>
            )}
            <SubmitButton>{signup ? "Sign up" : "Sign in"}</SubmitButton>
            <p className="text-center text-sm text-muted-foreground">
              {signup ? (
                <a className="underline" href={`/login?next=${encodeURIComponent(next)}`}>
                  Have an account? Sign in
                </a>
              ) : (
                <a className="underline" href={`/login?next=${encodeURIComponent(next)}&mode=signup`}>
                  New here? Create an account
                </a>
              )}
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

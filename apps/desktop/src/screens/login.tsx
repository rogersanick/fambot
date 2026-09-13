import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { Typewriter } from "@/components/ascii/typewriter";
import { FambotLogo } from "@/components/robot/logo";
import { api } from "@/lib/api";
import { signIn, signUp } from "@/lib/auth";

export function LoginScreen({ inviteMode = false }: { inviteMode?: boolean }) {
  const [signup, setSignup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const config = useQuery({ queryKey: ["config"], queryFn: api.config });

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "").trim();
    const password = String(fd.get("password") ?? "");
    const name = String(fd.get("name") ?? "").trim();
    try {
      const res = signup
        ? await signUp.email({ email, password, name: name || email.split("@")[0]! })
        : await signIn.email({ email, password });
      if (res.error) {
        setError(
          signup
            ? "Couldn't create the account — maybe it already exists?"
            : "Wrong email or password."
        );
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-6">
      <div className="animate-fade-up flex flex-col items-center gap-2">
        <FambotLogo className="text-primary h-10 sm:h-12" />
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
            {inviteMode
              ? "Sign in or create an account to accept your household invitation."
              : signup
                ? "One account per family member."
                : "Your household's shared brain."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4">
            {config.data?.googleAuth && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => signIn.social({ provider: "google", callbackURL: window.location.href })}
                >
                  Continue with Google
                </Button>
                <div className="text-muted-foreground flex items-center gap-2 text-xs">
                  <span className="bg-border h-px flex-1" /> or <span className="bg-border h-px flex-1" />
                </div>
              </>
            )}
            {signup && (
              <div className="grid gap-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" placeholder="Nick" required />
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" placeholder="you@example.com" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" required minLength={8} />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <SubmitButton pending={pending}>{signup ? "Sign up" : "Sign in"}</SubmitButton>
            <p className="text-muted-foreground text-center text-sm">
              <button type="button" className="underline" onClick={() => setSignup(!signup)}>
                {signup ? "Have an account? Sign in" : "New here? Create an account"}
              </button>
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

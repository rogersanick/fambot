import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function LinkPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  async function redeem(formData: FormData) {
    "use server";
    const code = String(formData.get("code") ?? "").trim().toLowerCase();
    if (!code) redirect("/link?error=1");

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("redeem_link_code", { p_code: code });
    if (error || !data) redirect("/link?error=1");
    const slug = (data as { household_slug?: string }).household_slug;
    redirect(slug ? `/h/${slug}` : "/");
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Link your account</CardTitle>
          <CardDescription>
            Text <span className="font-mono">@fambot link</span> in your group chat to get a
            one-time code, then enter it here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={redeem} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="code">One-time code</Label>
              <Input id="code" name="code" placeholder="ab12cd" autoComplete="off" required />
            </div>
            {params.error && (
              <p className="text-sm text-destructive">That code is invalid or expired — request a new one.</p>
            )}
            <Button type="submit">Link account</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

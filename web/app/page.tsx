import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: households } = await supabase
    .from("households")
    .select("slug, display_name")
    .order("display_name");

  if (!households || households.length === 0) {
    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>No household linked yet</CardTitle>
            <CardDescription>
              Text <span className="font-mono">@fambot link</span> in your group chat, then enter
              the code here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link href="/link">Enter a link code</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (households.length === 1) redirect(`/h/${households[0].slug}`);

  // Household switcher for users linked to multiple households.
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Choose a household</CardTitle>
          <CardDescription>You&apos;re a member of more than one.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {households.map((h) => (
            <Button key={h.slug} asChild variant="outline" className="justify-start">
              <Link href={`/h/${h.slug}`}>{h.display_name ?? h.slug}</Link>
            </Button>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}

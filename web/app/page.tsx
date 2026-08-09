import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: households } = await supabase.from("households").select("id, name").order("name");

  if (households && households.length === 1) redirect(`/h/${households[0].id}`);

  async function createHousehold(formData: FormData) {
    "use server";
    const name = String(formData.get("name") ?? "").trim();
    const timezone = String(formData.get("timezone") ?? "America/New_York").trim();
    if (!name) redirect("/");
    const db = await createClient();
    const { data, error } = await db.rpc("setup_household", {
      p_name: name,
      p_timezone: timezone || "America/New_York",
      p_role: "owner",
    });
    if (error || !data) redirect("/");
    redirect(`/h/${data}`);
  }

  if (!households || households.length === 0) {
    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Create your household</CardTitle>
            <CardDescription>
              One shared space for todos, calendar, and reminders. You can also let the agent set
              this up from the group chat.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createHousehold} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Household name</Label>
                <Input id="name" name="name" placeholder="Rogers Family" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="timezone">Timezone</Label>
                <Input id="timezone" name="timezone" defaultValue="America/New_York" />
              </div>
              <Button type="submit">Create household</Button>
            </form>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Choose a household</CardTitle>
          <CardDescription>You&apos;re a member of more than one.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {households.map((h) => (
            <Button key={h.id} asChild variant="outline" className="justify-start">
              <a href={`/h/${h.id}`}>{h.name}</a>
            </Button>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}

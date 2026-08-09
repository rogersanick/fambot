import Link from "next/link";
import { redirect } from "next/navigation";
import { getHousehold } from "@/lib/household";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const NAV = [
  ["", "Dashboard"],
  ["/today", "Today"],
  ["/tasks", "Tasks"],
  ["/calendar", "Calendar"],
  ["/settings", "Settings"],
] as const;

export default async function HouseholdLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const household = await getHousehold(slug);

  async function signOut() {
    "use server";
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  return (
    <div className="min-h-svh">
      <header className="border-b">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
          <Link href={`/h/${slug}`} className="flex items-center gap-2 font-semibold">
            {household.display_name ?? "Household"}
            {household.state !== "active" && (
              <Badge variant="secondary" className="capitalize">{household.state.replace("_", " ")}</Badge>
            )}
          </Link>
          <nav className="flex flex-1 flex-wrap items-center gap-1 text-sm">
            {NAV.map(([path, label]) => (
              <Button key={path} asChild variant="ghost" size="sm">
                <Link href={`/h/${slug}${path}`}>{label}</Link>
              </Button>
            ))}
          </nav>
          <form action={signOut}>
            <Button variant="outline" size="sm" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-6">{children}</main>
    </div>
  );
}

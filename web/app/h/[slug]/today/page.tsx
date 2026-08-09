import Link from "next/link";
import { getHousehold } from "@/lib/household";
import { createClient } from "@/lib/supabase/server";
import { fmtWhen, isOverdue, localDate } from "@/lib/format";
import { setTaskStatus } from "../actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function TodayPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const household = await getHousehold(slug);
  const tz = household.timezone ?? "UTC";
  const supabase = await createClient();
  const now = new Date();
  const todayStr = localDate(now, tz);

  const [{ data: tasks }, { data: members }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, short_code, title, due_at, assignee_member_id")
      .eq("household_id", household.id)
      .eq("status", "open")
      .order("due_at", { ascending: true, nullsFirst: false }),
    supabase.from("members").select("id, display_name, normalized_handle"),
  ]);

  const memberName = (id: string | null) => {
    const m = members?.find((x) => x.id === id);
    return m ? (m.display_name?.split(/\s+/)[0] ?? m.normalized_handle) : null;
  };

  const all = tasks ?? [];
  const overdue = all.filter((t) => t.due_at && isOverdue(t.due_at, now) && localDate(new Date(t.due_at), tz) !== todayStr);
  const today = all.filter((t) => t.due_at && localDate(new Date(t.due_at), tz) === todayStr);
  const undated = all.filter((t) => !t.due_at);

  const Section = ({ title, items }: { title: string; items: typeof all }) =>
    items.length === 0 ? null : (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {items.map((t) => (
            <div key={t.id} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
              <form action={setTaskStatus}>
                <input type="hidden" name="task_id" value={t.id} />
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="status" value="done" />
                <Button type="submit" variant="outline" size="sm" className="size-7 p-0" title="Mark done">
                  ✓
                </Button>
              </form>
              <Link href={`/h/${slug}/k/${t.short_code}`} className="flex-1 hover:underline">
                {memberName(t.assignee_member_id) && (
                  <span className="text-muted-foreground">{memberName(t.assignee_member_id)}: </span>
                )}
                {t.title}
              </Link>
              {t.due_at && (
                <Badge variant={isOverdue(t.due_at, now) ? "destructive" : "secondary"}>
                  {fmtWhen(t.due_at, tz, now)}
                </Badge>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    );

  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold tracking-tight">Today</h1>
      {all.length === 0 && <p className="text-sm text-muted-foreground">No open tasks — nice work.</p>}
      <Section title="Overdue" items={overdue} />
      <Section title="Due today" items={today} />
      <Section title="Anytime" items={undated} />
    </div>
  );
}

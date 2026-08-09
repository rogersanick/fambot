import Link from "next/link";
import { getHousehold } from "@/lib/household";
import { createClient } from "@/lib/supabase/server";
import { fmtWhen, isOverdue, localDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage({
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

  const [{ data: tasks }, { data: events }, { data: activity }, { data: members }] =
    await Promise.all([
      supabase
        .from("tasks")
        .select("id, short_code, title, due_at, assignee_member_id")
        .eq("household_id", household.id)
        .eq("status", "open")
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(20),
      supabase
        .from("events")
        .select("id, short_code, title, starts_at, location")
        .eq("household_id", household.id)
        .eq("status", "active")
        .gte("starts_at", now.toISOString())
        .lte("starts_at", new Date(now.getTime() + 7 * 86400000).toISOString())
        .order("starts_at")
        .limit(10),
      supabase
        .from("audit_log")
        .select("id, actor_type, action, entity_type, after_state, created_at")
        .eq("household_id", household.id)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase.from("members").select("id, display_name, normalized_handle"),
    ]);

  const memberName = (id: string | null) => {
    const m = members?.find((x) => x.id === id);
    return m ? (m.display_name?.split(/\s+/)[0] ?? m.normalized_handle) : null;
  };

  const todayTasks = (tasks ?? []).filter(
    (t) => t.due_at && (localDate(new Date(t.due_at), tz) === todayStr || isOverdue(t.due_at, now)),
  );

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Today&apos;s tasks</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/h/${slug}/today`}>View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="grid gap-2">
            {todayTasks.length === 0 && (
              <p className="text-sm text-muted-foreground">Nothing due today.</p>
            )}
            {todayTasks.map((t) => (
              <Link
                key={t.id}
                href={`/h/${slug}/k/${t.short_code}`}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-accent"
              >
                <span>
                  {memberName(t.assignee_member_id) && (
                    <span className="text-muted-foreground">{memberName(t.assignee_member_id)}: </span>
                  )}
                  {t.title}
                </span>
                <Badge variant={isOverdue(t.due_at) ? "destructive" : "secondary"}>
                  {fmtWhen(t.due_at, tz)}
                </Badge>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Next 7 days</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/h/${slug}/calendar`}>Calendar</Link>
            </Button>
          </CardHeader>
          <CardContent className="grid gap-2">
            {(events ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No upcoming events.</p>
            )}
            {(events ?? []).map((e) => (
              <div key={e.id} className="rounded-md border px-3 py-2 text-sm">
                <div className="font-medium">{e.title}</div>
                <div className="text-muted-foreground">
                  {fmtWhen(e.starts_at, tz)}
                  {e.location ? ` · ${e.location}` : ""}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-1">
          {(activity ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No activity yet.</p>
          )}
          {(activity ?? []).map((a) => {
            const title = (a.after_state as { title?: string } | null)?.title ?? "";
            const entity = a.entity_type === "tasks" ? "task" : "event";
            return (
              <div key={a.id} className="flex items-center gap-2 py-1 text-sm">
                <Badge variant="outline" className="capitalize">{a.actor_type}</Badge>
                <span className="capitalize">{a.action}</span>
                <span>{entity}</span>
                <span className="truncate font-medium">{title && `"${title}"`}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {fmtWhen(a.created_at, tz)}
                </span>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

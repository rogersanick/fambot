import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemeToggle } from "@/components/theme-toggle";
import { TerminalHero } from "@/components/household/terminal-hero";
import { OverviewTab, type TimelineItem, type WeekDay } from "@/components/household/overview-tab";
import { TodosTab } from "@/components/household/todos-tab";
import { CalendarTab } from "@/components/household/calendar-tab";
import { RemindersTab } from "@/components/household/reminders-tab";
import { SettingsTab } from "@/components/household/settings-tab";
import type { TaskChartDatum } from "@/components/household/task-chart";
import { fmtWhen, isOverdue, localDate } from "@/lib/format";
import { signOut } from "./actions";

const DAY_MS = 86400000;

export default async function HouseholdPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/h/${id}`)}`);

  const { data: household } = await supabase
    .from("households")
    .select("id, name, timezone")
    .eq("id", id)
    .maybeSingle();
  if (!household) notFound();
  const tz = household.timezone;

  // Server component: per-request "now" is intentional here.
  const now = new Date();

  const [{ data: members }, { data: channels }, { data: tasks }, { data: events }, { data: reminders }, { data: lists }] =
    await Promise.all([
      supabase.from("members").select("id, display_name, role, handle").eq("household_id", id).order("created_at"),
      supabase.from("channels").select("id, chat_guid, name").eq("household_id", id).order("created_at"),
      supabase
        .from("tasks")
        .select("id, title, status, due_at, completed_at, list_id, assignee:members!tasks_assignee_id_fkey(display_name)")
        .eq("household_id", id)
        .order("due_at", { ascending: true, nullsFirst: false })
        .order("created_at"),
      supabase
        .from("events")
        .select("id, title, starts_at, ends_at, location")
        .eq("household_id", id)
        // 45 days back so the calendar's month grid (and the tail of the
        // previous month it displays) has its events, not just yesterday's.
        .gte("starts_at", new Date(now.getTime() - 45 * DAY_MS).toISOString())
        .order("starts_at"),
      supabase
        .from("reminders")
        .select("id, message, fire_at, status, sent_at")
        .eq("household_id", id)
        .order("fire_at", { ascending: false })
        .limit(50),
      supabase.from("lists").select("id, name").eq("household_id", id).order("created_at"),
    ]);

  const allTasks = tasks ?? [];
  const allEvents = events ?? [];
  const allReminders = reminders ?? [];
  const openTasks = allTasks.filter((t) => t.status === "open");
  const doneTasks = allTasks.filter((t) => t.status === "done");
  const pendingReminders = allReminders.filter((r) => r.status === "pending");
  const overdueCount = openTasks.filter((t) => isOverdue(t.due_at, now)).length;

  // --- Overview data ---
  const weekKeys: string[] = [];
  const week: WeekDay[] = [];
  const dayNumFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, day: "numeric" });
  const weekdayFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getTime() + i * DAY_MS);
    const key = localDate(d, tz);
    weekKeys.push(key);
    week.push({
      key,
      label: weekdayFmt.format(d),
      dayNum: Number(dayNumFmt.format(d)),
      count: 0,
      isToday: i === 0,
    });
  }
  const weekIndex = new Map(weekKeys.map((k, i) => [k, i]));

  const eventSpark = Array(7).fill(0) as number[];
  for (const e of allEvents) {
    const i = weekIndex.get(localDate(new Date(e.starts_at), tz));
    if (i !== undefined) {
      week[i].count++;
      eventSpark[i]++;
    }
  }
  for (const t of openTasks) {
    if (!t.due_at) continue;
    const i = weekIndex.get(localDate(new Date(t.due_at), tz));
    if (i !== undefined) week[i].count++;
  }

  // Bin completions by household-local calendar day (matching the heatmap),
  // not by UTC elapsed days — near-midnight completions land on the right bar.
  const completionSpark = Array(7).fill(0) as number[];
  const pastDayIndex = new Map<string, number>();
  for (let i = 0; i < 7; i++) pastDayIndex.set(localDate(new Date(now.getTime() - i * DAY_MS), tz), 6 - i);
  for (const t of doneTasks) {
    if (!t.completed_at) continue;
    const idx = pastDayIndex.get(localDate(new Date(t.completed_at), tz));
    if (idx !== undefined) completionSpark[idx]++;
  }
  const doneThisWeek = completionSpark.reduce((a, b) => a + b, 0);

  const byAssignee = new Map<string, { open: number; done: number }>();
  for (const t of allTasks) {
    if (t.status === "cancelled") continue;
    const name = t.assignee?.display_name ?? "Anyone";
    if (!byAssignee.has(name)) byAssignee.set(name, { open: 0, done: 0 });
    byAssignee.get(name)![t.status === "done" ? "done" : "open"]++;
  }
  const taskChartData: TaskChartDatum[] = [...byAssignee.entries()]
    .map(([assignee, counts]) => ({ assignee, ...counts }))
    .sort((a, b) => b.open + b.done - (a.open + a.done));

  const weekEnd = now.getTime() + 7 * DAY_MS;
  const timeline: TimelineItem[] = [
    ...allEvents
      .filter((e) => {
        const t = new Date(e.starts_at).getTime();
        return t >= now.getTime() && t < weekEnd;
      })
      .map((e) => ({
        id: e.id,
        kind: "event" as const,
        title: e.title,
        when: fmtWhen(e.starts_at, tz, now),
        detail: e.location ?? undefined,
        iso: e.starts_at,
      })),
    ...pendingReminders
      .filter((r) => {
        const t = new Date(r.fire_at).getTime();
        return t >= now.getTime() && t < weekEnd;
      })
      .map((r) => ({
        id: r.id,
        kind: "reminder" as const,
        title: r.message,
        when: fmtWhen(r.fire_at, tz, now),
        detail: undefined,
        iso: r.fire_at,
      })),
  ]
    .sort((a, b) => a.iso.localeCompare(b.iso))
    .map((item) => ({ id: item.id, kind: item.kind, title: item.title, when: item.when, detail: item.detail }));

  const eventsThisWeek = eventSpark.reduce((a, b) => a + b, 0);

  // --- Terminal boot sequence ---
  const nextEvent = allEvents.find((e) => new Date(e.starts_at).getTime() >= now.getTime());
  const nextReminder = [...pendingReminders]
    .filter((r) => new Date(r.fire_at).getTime() >= now.getTime())
    .sort((a, b) => a.fire_at.localeCompare(b.fire_at))[0];
  const bootLines = [
    "> fambot v2.0 — household os",
    `> household: ${household.name} · ${tz}`,
    `> ${openTasks.length} open todo${openTasks.length === 1 ? "" : "s"}${overdueCount > 0 ? ` · ${overdueCount} overdue` : ""}`,
    nextEvent
      ? `> next event: ${nextEvent.title} — ${fmtWhen(nextEvent.starts_at, tz, now)}`
      : "> next event: none scheduled",
    nextReminder
      ? `> next reminder: ${nextReminder.message} — ${fmtWhen(nextReminder.fire_at, tz, now)}`
      : "> next reminder: none pending",
    "> all systems nominal ✓",
  ];

  return (
    <main className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <header className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl">{household.name}</h1>
          <p className="text-muted-foreground text-sm">{tz}</p>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <form action={signOut}>
            <Button variant="ghost" size="sm" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      <div className="mb-6">
        <TerminalHero lines={bootLines} />
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="todos">Todos</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="reminders">Reminders</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab
            stats={{
              openTodos: openTasks.length,
              overdue: overdueCount,
              eventsThisWeek,
              pendingReminders: pendingReminders.length,
              doneThisWeek,
            }}
            completionSpark={completionSpark}
            eventSpark={eventSpark}
            taskChartData={taskChartData}
            week={week}
            timeline={timeline}
          />
        </TabsContent>

        <TabsContent value="todos">
          <TodosTab householdId={id} tz={tz} members={members ?? []} tasks={allTasks} lists={lists ?? []} />
        </TabsContent>

        <TabsContent value="calendar">
          <CalendarTab householdId={id} tz={tz} events={allEvents} />
        </TabsContent>

        <TabsContent value="reminders">
          <RemindersTab householdId={id} tz={tz} reminders={allReminders} />
        </TabsContent>

        <TabsContent value="settings">
          <SettingsTab
            householdId={id}
            householdName={household.name}
            tz={tz}
            members={members ?? []}
            channels={channels ?? []}
          />
        </TabsContent>
      </Tabs>
    </main>
  );
}

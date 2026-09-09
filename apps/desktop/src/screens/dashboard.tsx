import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemeToggle } from "@/components/theme-toggle";
import { TerminalHero } from "@/components/household/terminal-hero";
import { OverviewTab, type TimelineItem, type WeekDay } from "@/components/household/overview-tab";
import { TodosTab } from "@/components/household/todos-tab";
import { CalendarTab } from "@/components/household/calendar-tab";
import { RemindersTab } from "@/components/household/reminders-tab";
import { SettingsTab } from "@/components/household/settings-tab";
import { ChatTab } from "@/components/household/chat-tab";
import { ConnectionsTab } from "@/components/household/connections-tab";
import type { TaskChartDatum } from "@/components/household/task-chart";
import { AsciiSpinner } from "@/components/ascii/ascii-spinner";
import { fmtWhen, isOverdue, localDate } from "@/lib/format";
import { api } from "@/lib/api";
import { signOut } from "@/lib/auth";
import {
  toEventRows,
  toMemberRows,
  toReminderRows,
  toTaskRows,
} from "@/components/household/types";

const DAY_MS = 86400000;

export function Dashboard({ householdId }: { householdId: string }) {
  const bundle = useQuery({
    queryKey: ["household", householdId],
    queryFn: () => api.household(householdId),
    refetchInterval: 30_000,
  });
  const tasksQ = useQuery({
    queryKey: ["household", householdId, "tasks"],
    queryFn: () => api.tasks.list(householdId),
    refetchInterval: 15_000,
  });
  const eventsQ = useQuery({
    queryKey: ["household", householdId, "events"],
    queryFn: () => api.events.list(householdId),
    refetchInterval: 30_000,
  });
  const remindersQ = useQuery({
    queryKey: ["household", householdId, "reminders"],
    queryFn: () => api.reminders.list(householdId),
    refetchInterval: 15_000,
  });

  const now = new Date();

  const computed = useMemo(() => {
    if (!bundle.data || !tasksQ.data || !eventsQ.data || !remindersQ.data) return null;
    const tz = bundle.data.household.timezone;
    const members = toMemberRows(bundle.data.members, bundle.data.identities);
    const allTasks = toTaskRows(tasksQ.data.tasks, bundle.data.members);
    const allEvents = toEventRows(eventsQ.data.events);
    const allReminders = toReminderRows(remindersQ.data.reminders);
    const lists = tasksQ.data.lists;

    const openTasks = allTasks.filter((t) => t.status === "open");
    const doneTasks = allTasks.filter((t) => t.status === "done");
    const pendingReminders = allReminders.filter((r) => r.status === "pending");
    const overdueCount = openTasks.filter((t) => isOverdue(t.due_at, now)).length;

    // Week heat + sparklines
    const weekKeys: string[] = [];
    const week: WeekDay[] = [];
    const dayNumFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, day: "numeric" });
    const weekdayFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
    for (let i = 0; i < 7; i++) {
      const d = new Date(now.getTime() + i * DAY_MS);
      const key = localDate(d, tz);
      weekKeys.push(key);
      week.push({ key, label: weekdayFmt.format(d), dayNum: Number(dayNumFmt.format(d)), count: 0, isToday: i === 0 });
    }
    const weekIndex = new Map(weekKeys.map((k, i) => [k, i]));

    const eventSpark = Array(7).fill(0) as number[];
    for (const e of allEvents) {
      const i = weekIndex.get(localDate(new Date(e.starts_at), tz));
      if (i !== undefined) {
        week[i]!.count++;
        eventSpark[i]++;
      }
    }
    for (const t of openTasks) {
      if (!t.due_at) continue;
      const i = weekIndex.get(localDate(new Date(t.due_at), tz));
      if (i !== undefined) week[i]!.count++;
    }

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
      .map(({ iso: _iso, ...item }) => item);

    const eventsThisWeek = eventSpark.reduce((a, b) => a + b, 0);

    // Terminal boot sequence
    const nextEvent = allEvents.find((e) => new Date(e.starts_at).getTime() >= now.getTime());
    const nextReminder = [...pendingReminders]
      .filter((r) => new Date(r.fire_at).getTime() >= now.getTime())
      .sort((a, b) => a.fire_at.localeCompare(b.fire_at))[0];
    const bridgeOk = bundle.data.bridge.connected;
    const bootLines = [
      "> fambot v2.0 — household os",
      `> household: ${bundle.data.household.name} · ${tz}`,
      `> ${openTasks.length} open todo${openTasks.length === 1 ? "" : "s"}${overdueCount > 0 ? ` · ${overdueCount} overdue` : ""}`,
      nextEvent
        ? `> next event: ${nextEvent.title} — ${fmtWhen(nextEvent.starts_at, tz, now)}`
        : "> next event: none scheduled",
      nextReminder
        ? `> next reminder: ${nextReminder.message} — ${fmtWhen(nextReminder.fire_at, tz, now)}`
        : "> next reminder: none pending",
      bridgeOk ? "> imsg bridge: connected ✓" : "> imsg bridge: offline — app chat only",
      "> all systems nominal ✓",
    ];

    return {
      tz,
      members,
      allTasks,
      allEvents,
      allReminders,
      lists,
      stats: {
        openTodos: openTasks.length,
        overdue: overdueCount,
        eventsThisWeek,
        pendingReminders: pendingReminders.length,
        doneThisWeek,
      },
      completionSpark,
      eventSpark,
      taskChartData,
      week,
      timeline,
      bootLines,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle.data, tasksQ.data, eventsQ.data, remindersQ.data]);

  if (!computed || !bundle.data) {
    return (
      <main className="flex min-h-svh items-center justify-center">
        <div className="text-muted-foreground flex items-center gap-2 font-mono text-sm">
          <AsciiSpinner /> loading household…
        </div>
      </main>
    );
  }

  const { household, me, bridge, members: rawMembers, identities } = bundle.data;

  return (
    <main className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <header className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl">{household.name}</h1>
          <p className="text-muted-foreground text-sm">{computed.tz}</p>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={() => signOut().then(() => window.location.reload())}>
            Sign out
          </Button>
        </div>
      </header>

      <div className="mb-6">
        <TerminalHero lines={computed.bootLines} />
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="todos">Todos</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="reminders">Reminders</TabsTrigger>
          <TabsTrigger value="connections">Connections</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab
            stats={computed.stats}
            completionSpark={computed.completionSpark}
            eventSpark={computed.eventSpark}
            taskChartData={computed.taskChartData}
            week={computed.week}
            timeline={computed.timeline}
          />
        </TabsContent>

        <TabsContent value="chat">
          <ChatTab householdId={householdId} meName={me.displayName} />
        </TabsContent>

        <TabsContent value="todos">
          <TodosTab
            householdId={householdId}
            tz={computed.tz}
            members={computed.members}
            tasks={computed.allTasks}
            lists={computed.lists}
          />
        </TabsContent>

        <TabsContent value="calendar">
          <CalendarTab householdId={householdId} tz={computed.tz} events={computed.allEvents} />
        </TabsContent>

        <TabsContent value="reminders">
          <RemindersTab householdId={householdId} tz={computed.tz} reminders={computed.allReminders} />
        </TabsContent>

        <TabsContent value="connections">
          <ConnectionsTab bridge={bridge} />
        </TabsContent>

        <TabsContent value="settings">
          <SettingsTab
            householdId={householdId}
            householdName={household.name}
            tz={computed.tz}
            members={toMemberRows(rawMembers, identities)}
            bridge={bridge}
          />
        </TabsContent>
      </Tabs>
    </main>
  );
}

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemeToggle } from "@/components/theme-toggle";
import { TerminalHero } from "@/components/household/terminal-hero";
import { OverviewTab, type TimelineItem, type WeekDay } from "@/components/household/overview-tab";
import { TasksTab } from "@/components/household/todos-tab";
import { ListsTab } from "@/components/household/lists-tab";
import { CalendarTab } from "@/components/household/calendar-tab";
import { RemindersTab } from "@/components/household/reminders-tab";
import { SettingsTab } from "@/components/household/settings-tab";
import { ChatTab } from "@/components/household/chat-tab";
import { ConnectionsTab } from "@/components/household/connections-tab";
import { MobileTabBar } from "@/components/household/mobile-tab-bar";
import { DASHBOARD_TABS, type DashboardTab, isDashboardTab } from "@/components/household/dashboard-tabs";
import type { TaskChartDatum } from "@/components/household/task-chart";
import { RobotSpinner } from "@/components/robot/spinner";
import { fmtWhen, isOverdue, localDate } from "@/lib/format";
import { api } from "@/lib/api";
import { signOut } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { useIsMobile, useKeyboardOffset } from "@/lib/use-mobile";
import {
  toEventRows,
  toListRows,
  toMemberRows,
  toReminderRows,
  toTaskRows,
} from "@/components/household/types";
import { eventLinks, taskLinks, withoutReminders } from "@/components/household/artifact-links";

const DAY_MS = 86400000;

export function Dashboard({ householdId }: { householdId: string }) {
  const isMobile = useIsMobile();
  const keyboardOffset = useKeyboardOffset();
  const [tab, setTab] = useState<DashboardTab>("overview");
  const [moreOpen, setMoreOpen] = useState(false);
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
    if (!bundle.data) return null;
    const tz = bundle.data.household.timezone;
    const members = toMemberRows(
      bundle.data.members,
      bundle.data.identities,
      bundle.data.invites
    );
    const allTasks = tasksQ.data
      ? toTaskRows(tasksQ.data.tasks, bundle.data.members, tasksQ.data.series)
      : [];
    const allEvents = eventsQ.data ? toEventRows(eventsQ.data.events) : [];
    const allReminders = remindersQ.data
      ? toReminderRows(remindersQ.data.reminders, {
          tasks: tasksQ.data?.tasks ?? [],
          events: eventsQ.data?.events ?? [],
        })
      : [];
    const lists = tasksQ.data ? toListRows(tasksQ.data.lists) : [];

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
    const weekDays = new Set(weekKeys);
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
          body: e.notes ?? undefined,
          day: localDate(new Date(e.starts_at), tz),
          iso: e.starts_at,
          links: withoutReminders(eventLinks(e, { tasks: allTasks, lists, reminders: allReminders, tz })),
        })),
      ...openTasks
        .filter((t) => t.due_at && weekDays.has(localDate(new Date(t.due_at), tz)))
        .map((t) => ({
          id: t.id,
          kind: "task" as const,
          title: t.title,
          when: fmtWhen(t.due_at!, tz, now),
          detail: t.assignee?.display_name,
          day: localDate(new Date(t.due_at!), tz),
          iso: t.due_at!,
          links: withoutReminders(taskLinks(t, { lists, events: allEvents, reminders: allReminders, tz })),
        })),
    ]
      .sort((a, b) => a.iso.localeCompare(b.iso))
      .map(({ iso: _iso, ...item }) => item);

    const eventsThisWeek = eventSpark.reduce((a, b) => a + b, 0);

    // Terminal boot sequence — kept short; the dashboard below has the details.
    const bootLines = [
      "> fambot v2.0 — household os",
      `> household: ${bundle.data.household.name} · ${tz}`,
    ];

    return {
      tz,
      members,
      allTasks,
      allEvents,
      allReminders,
      lists,
      stats: {
        openTasks: openTasks.length,
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
          <RobotSpinner /> loading household…
        </div>
      </main>
    );
  }

  const { household, me } = bundle.data;
  const chatOpen = tab === "chat";

  return (
    <main
      className={cn(
        "mx-auto w-full max-w-5xl",
        isMobile
          ? "flex h-dvh flex-col overflow-hidden px-4"
          : "p-4 sm:p-6"
      )}
      style={
        isMobile
          ? {
              paddingTop: "env(safe-area-inset-top)",
              paddingBottom: keyboardOffset,
            }
          : undefined
      }
    >
      <header
        className={cn(
          "flex items-center justify-between",
          isMobile ? "shrink-0 py-3" : "mb-5"
        )}
      >
        <div className="min-w-0">
          <h1 className={cn("font-serif", isMobile ? "truncate text-xl" : "text-3xl")}>
            {household.name}
          </h1>
          <p className="text-muted-foreground text-sm">{computed.tz}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={() => signOut().then(() => window.location.reload())}>
            Sign out
          </Button>
        </div>
      </header>

      {!isMobile && (
        <div className="mb-6">
          <TerminalHero lines={computed.bootLines} />
        </div>
      )}

      <Tabs
        value={tab}
        onValueChange={(next) => {
          if (isDashboardTab(next)) setTab(next);
        }}
        className={cn(isMobile && "flex min-h-0 flex-1 flex-col gap-0")}
      >
        <TabsList className={cn("mb-4", isMobile && "hidden")}>
          {DASHBOARD_TABS.map((id) => (
            <TabsTrigger key={id} value={id}>
              {id.charAt(0).toUpperCase() + id.slice(1)}
            </TabsTrigger>
          ))}
        </TabsList>

        <div
          className={cn(
            isMobile && "min-h-0 flex-1",
            isMobile && (chatOpen ? "flex flex-col overflow-hidden" : "overflow-y-auto pb-4")
          )}
        >
          <TabsContent value="overview" className={cn(isMobile && "mt-0")}>
            <OverviewTab
              householdId={householdId}
              stats={computed.stats}
              completionSpark={computed.completionSpark}
              eventSpark={computed.eventSpark}
              taskChartData={computed.taskChartData}
              week={computed.week}
              timeline={computed.timeline}
            />
          </TabsContent>

          <TabsContent
            value="chat"
            className={cn(isMobile && chatOpen && "mt-0 flex min-h-0 flex-1 flex-col")}
          >
            <ChatTab householdId={householdId} meName={me.displayName} fillViewport={isMobile} />
          </TabsContent>

          <TabsContent value="tasks" className={cn(isMobile && "mt-0")}>
            <TasksTab
              householdId={householdId}
              tz={computed.tz}
              members={computed.members}
              tasks={computed.allTasks}
              lists={computed.lists}
              events={computed.allEvents}
              reminders={computed.allReminders}
            />
          </TabsContent>

          <TabsContent value="lists" className={cn(isMobile && "mt-0")}>
            <ListsTab
              householdId={householdId}
              tz={computed.tz}
              lists={computed.lists}
              tasks={computed.allTasks}
              events={computed.allEvents}
            />
          </TabsContent>

          <TabsContent value="calendar" className={cn(isMobile && "mt-0")}>
            <CalendarTab
              householdId={householdId}
              tz={computed.tz}
              events={computed.allEvents}
              tasks={computed.allTasks}
              lists={computed.lists}
              reminders={computed.allReminders}
            />
          </TabsContent>

          <TabsContent value="reminders" className={cn(isMobile && "mt-0")}>
            <RemindersTab
              householdId={householdId}
              tz={computed.tz}
              reminders={computed.allReminders}
              tasks={computed.allTasks}
              events={computed.allEvents}
            />
          </TabsContent>

          <TabsContent value="connections" className={cn(isMobile && "mt-0")}>
            <ConnectionsTab householdId={householdId} isOwner={me.role === "owner"} members={computed.members} />
          </TabsContent>

          <TabsContent value="settings" className={cn(isMobile && "mt-0")}>
            <SettingsTab
              householdId={householdId}
              householdName={household.name}
              tz={computed.tz}
              meId={me.id}
              members={computed.members}
            />
          </TabsContent>
        </div>

        {isMobile && (
          <MobileTabBar
            value={tab}
            onChange={setTab}
            moreOpen={moreOpen}
            onMoreOpenChange={setMoreOpen}
          />
        )}
      </Tabs>
    </main>
  );
}

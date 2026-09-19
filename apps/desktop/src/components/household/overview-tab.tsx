import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RobotEmptyState } from "@/components/robot/scenes";
import { TaskChart, type TaskChartDatum } from "./task-chart";
import { ArtifactLink } from "./artifact-link";
import { ArtifactLinkChips, type LinkedArtifact } from "./artifact-links";
import { cn } from "@/lib/utils";

export type WeekDay = {
  key: string;
  label: string;
  dayNum: number;
  count: number;
  isToday: boolean;
};

export type TimelineItem = {
  id: string;
  kind: "event" | "task";
  title: string;
  when: string;
  detail?: string;
  /** Event description/body — distinct from associated reminders/lists. */
  body?: string;
  /** YYYY-MM-DD in the household timezone; matches WeekDay.key. */
  day: string;
  links?: LinkedArtifact[];
};

const KIND_DOT: Record<TimelineItem["kind"], string> = {
  event: "bg-chart-4",
  task: "bg-chart-1",
};

export type OverviewStats = {
  openTasks: number;
  overdue: number;
  eventsThisWeek: number;
  pendingReminders: number;
  doneThisWeek: number;
};

type OverviewTabProps = {
  householdId: string;
  stats: OverviewStats;
  /** Completed-task counts for the last 7 days, oldest first. */
  completionSpark: number[];
  /** Event counts for the next 7 days, today first. */
  eventSpark: number[];
  taskChartData: TaskChartDatum[];
  week: WeekDay[];
  timeline: TimelineItem[];
};

function Sparkline({ counts, colorClass }: { counts: number[]; colorClass: string }) {
  const max = Math.max(1, ...counts);
  return (
    <div className="flex h-8 items-end gap-1" aria-hidden>
      {counts.map((c, i) => (
        <div
          key={i}
          className={cn("animate-grow-in w-2 origin-bottom rounded-sm", colorClass)}
          style={{ height: `${Math.max(12, (c / max) * 100)}%`, opacity: c === 0 ? 0.25 : 1, animationDelay: `${i * 60}ms` }}
        />
      ))}
    </div>
  );
}

function StatCard({
  label,
  value,
  footnote,
  spark,
  alert,
  delay,
}: {
  label: string;
  value: number;
  footnote: string;
  spark?: React.ReactNode;
  alert?: boolean;
  delay: number;
}) {
  return (
    <Card className="animate-fade-up gap-2 py-4" style={{ animationDelay: `${delay}ms` }}>
      <CardContent className="flex items-end justify-between px-4">
        <div>
          <p className="text-muted-foreground text-xs tracking-wide uppercase">{label}</p>
          <p className={cn("font-serif text-2xl md:text-3xl", alert && value > 0 && "text-destructive")}>{value}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">{footnote}</p>
        </div>
        {spark}
      </CardContent>
    </Card>
  );
}

const HEAT_STOPS = [4, 18, 38, 62, 85];

function heatColor(count: number): string {
  const pct = HEAT_STOPS[Math.min(count, HEAT_STOPS.length - 1)];
  return `color-mix(in oklab, var(--primary) ${pct}%, var(--muted))`;
}

export function OverviewTab({
  householdId,
  stats,
  completionSpark,
  eventSpark,
  taskChartData,
  week,
  timeline,
}: OverviewTabProps) {
  const hasTasks = taskChartData.some((d) => d.open + d.doneThisWeek > 0);
  /** Day key selected in "The week ahead"; null = show the whole week. */
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const selected = selectedDay ? week.find((d) => d.key === selectedDay) : undefined;
  const visibleTimeline = selected ? timeline.filter((item) => item.day === selected.key) : timeline;
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Open tasks"
          value={stats.openTasks}
          footnote={`${stats.doneThisWeek} done this week`}
          spark={<Sparkline counts={completionSpark} colorClass="bg-chart-1" />}
          delay={0}
        />
        <StatCard
          label="Overdue"
          value={stats.overdue}
          footnote={stats.overdue > 0 ? "needs attention" : "all clear"}
          alert
          delay={60}
        />
        <StatCard
          label="Events this week"
          value={stats.eventsThisWeek}
          footnote="next 7 days"
          spark={<Sparkline counts={eventSpark} colorClass="bg-chart-4" />}
          delay={120}
        />
        <StatCard label="Reminders" value={stats.pendingReminders} footnote="pending delivery" delay={180} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="animate-fade-up" style={{ animationDelay: "240ms" }}>
          <CardHeader>
            <CardTitle className="font-serif text-lg">Who&apos;s carrying the load</CardTitle>
          </CardHeader>
          <CardContent>
            {hasTasks ? (
              <TaskChart data={taskChartData} />
            ) : (
              <RobotEmptyState caption="Nothing on anyone's plate — plant a task." />
            )}
          </CardContent>
        </Card>

        <Card className="animate-fade-up" style={{ animationDelay: "300ms" }}>
          <CardHeader>
            <CardTitle className="font-serif text-lg">The week ahead</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-2">
              {week.map((d) => (
                <div key={d.key} className="flex flex-col items-center gap-1.5">
                  <span className="text-muted-foreground text-[10px] tracking-wide uppercase">{d.label}</span>
                  <button
                    type="button"
                    onClick={() => setSelectedDay((cur) => (cur === d.key ? null : d.key))}
                    aria-pressed={selectedDay === d.key}
                    className={cn(
                      "flex aspect-square w-full max-w-12 cursor-pointer flex-col items-center justify-center rounded-lg transition-transform hover:scale-105",
                      d.isToday && "ring-ring ring-2 ring-offset-2 ring-offset-background",
                      selectedDay === d.key && "ring-primary ring-2 ring-offset-2 ring-offset-background",
                    )}
                    style={{ backgroundColor: heatColor(d.count) }}
                    title={`${d.count} item${d.count === 1 ? "" : "s"} — click to filter`}
                  >
                    <span className={cn("text-sm font-medium", d.count >= 3 && "text-primary-foreground")}>
                      {d.dayNum}
                    </span>
                  </button>
                  <span className="text-muted-foreground text-[10px]">{d.count > 0 ? d.count : "·"}</span>
                </div>
              ))}
            </div>
            <p className="text-muted-foreground mt-3 text-xs">
              Events and due tasks per day — darker means busier. Click a day to filter the list below.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="animate-fade-up" style={{ animationDelay: "360ms" }}>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="font-serif text-lg">
              {selected ? `Coming up · ${selected.label} ${selected.dayNum}` : "Coming up"}
            </CardTitle>
            {selected && (
              <Button variant="ghost" size="sm" onClick={() => setSelectedDay(null)}>
                Show whole week
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {visibleTimeline.length === 0 ? (
            <RobotEmptyState
              caption={
                selected
                  ? `Nothing scheduled for ${selected.label} ${selected.dayNum}.`
                  : "Nothing on the horizon this week."
              }
            />
          ) : (
            <div className="stagger-children border-border ml-2 grid gap-0 border-l-2">
              {visibleTimeline.map((item) => (
                <div key={`${item.kind}-${item.id}`} className="relative py-2 pl-5">
                  <span
                    className={cn(
                      "ring-background absolute top-3.5 -left-[5px] h-2 w-2 rounded-full ring-2",
                      KIND_DOT[item.kind],
                    )}
                    aria-hidden
                  />
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <span className="text-muted-foreground w-36 shrink-0 text-xs">{item.when}</span>
                    <ArtifactLink
                      type={item.kind}
                      id={item.id}
                      className="text-sm"
                    >
                      {item.title}
                    </ArtifactLink>
                    {item.detail && <span className="text-muted-foreground text-xs">{item.detail}</span>}
                    <span className="text-muted-foreground/70 ml-auto font-mono text-[10px] uppercase">
                      {item.kind}
                    </span>
                  </div>
                  {item.body && (
                    <p className="text-muted-foreground mt-0.5 text-sm whitespace-pre-wrap sm:pl-[9.5rem]">
                      {item.body}
                    </p>
                  )}
                  <ArtifactLinkChips householdId={householdId} links={item.links ?? []} className="mt-1 pl-[9.5rem]" />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

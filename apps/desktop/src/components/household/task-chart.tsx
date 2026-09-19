import { cn } from "@/lib/utils";

export type TaskChartDatum = {
  assignee: string;
  /** Currently open tasks assigned to this person. */
  open: number;
  /** Subset of `open` that is past due. */
  overdue: number;
  /** Tasks completed in the last 7 days. */
  doneThisWeek: number;
  /** True for the "Unassigned" bucket row. */
  unassigned?: boolean;
};

const SEGMENTS = [
  { key: "overdue", label: "Overdue", className: "bg-destructive" },
  { key: "openOnTrack", label: "Open", className: "bg-chart-2" },
  { key: "doneThisWeek", label: "Done this week", className: "bg-chart-1 opacity-50" },
] as const;

function headline(data: TaskChartDatum[]): string {
  const people = data.filter((d) => !d.unassigned);
  const totalOpen = data.reduce((sum, d) => sum + d.open, 0);
  if (totalOpen === 0) return "Nothing open — everyone's caught up.";
  const top = people.reduce((a, b) => (b.open > (a?.open ?? 0) ? b : a), undefined as TaskChartDatum | undefined);
  if (!top || top.open === 0) return "Every open task is up for grabs.";
  const pct = Math.round((top.open / totalOpen) * 100);
  if (people.filter((p) => p.open > 0).length === 1 && people.length > 1)
    return `${top.assignee} has all ${totalOpen === 1 ? "the open work" : `${totalOpen} open tasks`}.`;
  if (pct >= 60) return `${top.assignee} is carrying ${pct}% of the open tasks.`;
  return "The load looks fairly balanced.";
}

/**
 * Current load per person: a segmented bar of overdue + open tasks, with
 * completions from the last 7 days shown faded for credit. All bars share one
 * scale so lengths are comparable across the household.
 */
export function TaskChart({ data }: { data: TaskChartDatum[] }) {
  const max = Math.max(1, ...data.map((d) => d.open + d.doneThisWeek));
  return (
    <div className="grid gap-4">
      <p className="text-sm">{headline(data)}</p>

      <div className="grid gap-3">
        {data.map((d) => {
          const widths = {
            overdue: d.overdue,
            openOnTrack: d.open - d.overdue,
            doneThisWeek: d.doneThisWeek,
          };
          return (
            <div key={d.assignee} className="grid gap-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className={cn("truncate text-sm", d.unassigned && "text-muted-foreground italic")}>
                  {d.assignee}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {d.open} open
                  {d.overdue > 0 && <span className="text-destructive"> · {d.overdue} overdue</span>}
                  {" · "}
                  {d.doneThisWeek} done
                </span>
              </div>
              <div className="bg-muted flex h-2.5 w-full overflow-hidden rounded-full">
                {SEGMENTS.map(({ key, className }) =>
                  widths[key] > 0 ? (
                    <div
                      key={key}
                      className={className}
                      style={{ width: `${(widths[key] / max) * 100}%` }}
                    />
                  ) : null
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {SEGMENTS.map(({ key, label, className }) => (
          <span key={key} className="flex items-center gap-1.5">
            <span className={cn("h-2 w-2 rounded-full", className)} aria-hidden />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateSurface } from "./create-surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SubmitButton } from "@/components/submit-button";
import { DateTimePicker } from "@/components/date-time-picker";
import { RecurrencePicker } from "@/components/recurrence-picker";
import { SnoozeMenu } from "@/components/snooze-menu";
import { RobotEmptyState } from "@/components/robot/scenes";
import { MemberAvatar } from "./member-avatar";
import { CommentThread } from "./comment-thread";
import { fmtWhen, isOverdue, localDate } from "@/lib/format";
import { api, localToIso } from "@/lib/api";
import { useAction } from "./use-actions";
import type { EventRow, ListRow, MemberRow, ReminderRow, TaskRow } from "./types";
import { Calendar } from "@/components/ui/calendar";
import { ArtifactLink } from "./artifact-link";
import { CompleteTaskButton } from "./complete-task-button";
import {
  ArtifactLinkChips,
  ArtifactSelect,
  selectClass,
  taskLinks,
} from "./artifact-links";
import { cn } from "@/lib/utils";

type Bucket = "overdue" | "today" | "upcoming" | "someday";
type Filter = "all" | "overdue" | "today";

const BUCKET_LABELS: Record<Bucket, string> = {
  overdue: "Overdue",
  today: "Today",
  upcoming: "Upcoming",
  someday: "Someday",
};

function TaskItem({
  householdId,
  task,
  tz,
  list,
  links,
}: {
  householdId: string;
  task: TaskRow;
  tz: string;
  list?: ListRow;
  links: ReturnType<typeof taskLinks>;
}) {
  const overdue = isOverdue(task.due_at);
  const { run, pending } = useAction(householdId);
  return (
    <div>
      <CommentThread householdId={householdId} tz={tz} subject="task" subjectId={task.id}>
        {(toggle) => (
          <>
          <div className="group hover:bg-muted/50 flex flex-wrap items-center gap-2 rounded-md px-2 py-2 transition-colors sm:flex-nowrap sm:gap-3 sm:py-1.5">
            <ArtifactLink type="task" id={task.id} className="min-w-0 flex-1 text-sm">
              {task.title}
            </ArtifactLink>
            {task.recurrence && (
              <span
                className="text-muted-foreground rounded-full border px-1.5 py-0.5 text-[10px]"
                title={`Repeats ${task.recurrence}`}
              >
                ↻ {task.recurrence}
              </span>
            )}
            {task.assignee && (
              <span className="flex items-center gap-1.5" title={task.assignee.display_name}>
                <MemberAvatar name={task.assignee.display_name} size="sm" />
              </span>
            )}
            {task.due_at && (
              <span
                className={cn("text-xs", overdue ? "text-destructive font-medium" : "text-muted-foreground")}
                title={overdue ? "Overdue" : undefined}
              >
                {fmtWhen(task.due_at, tz)}
              </span>
            )}
            {task.due_at && (
              <SnoozeMenu
                tz={tz}
                isRecurring={Boolean(task.series_id)}
                onPostpone={(iso) => run(() => api.tasks.patch(householdId, task.id, { dueAt: iso }))}
                onStopRepeating={
                  task.series_id
                    ? () => run(() => api.taskSeries.cancel(householdId, task.series_id!))
                    : undefined
                }
              />
            )}
            <CompleteTaskButton
              pending={pending}
              onComplete={() => void run(() => api.tasks.patch(householdId, task.id, { status: "done" }))}
            />
            {toggle}
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => run(() => api.tasks.patch(householdId, task.id, { status: "cancelled" }))}
              className="text-muted-foreground h-8 w-8 p-0 opacity-100 transition-opacity md:h-6 md:w-6 md:opacity-0 md:group-hover:opacity-100"
              title="Cancel"
            >
              &times;
            </Button>
          </div>
          <ArtifactLinkChips householdId={householdId} links={links} className="pb-1 pl-2" />
          {list && list.items.length > 0 && (
            <div className="text-muted-foreground grid gap-0.5 pb-1 pl-2">
              {list.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="hover:text-foreground flex items-center gap-1.5 text-left text-xs"
                  onClick={() =>
                    void run(() =>
                      api.lists.patchItem(householdId, list.id, item.id, { completed: !item.completed_at })
                    )
                  }
                >
                  <span aria-hidden>{item.completed_at ? "✓" : "○"}</span>
                  <span className={item.completed_at ? "line-through" : ""}>{item.body}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      </CommentThread>
    </div>
  );
}

function BucketSection({
  householdId,
  tz,
  buckets,
  filter,
  listByTask,
  linkCtx,
}: {
  householdId: string;
  tz: string;
  buckets: Record<Bucket, TaskRow[]>;
  filter: Filter;
  listByTask: Map<string, ListRow>;
  linkCtx: { lists: ListRow[]; events: EventRow[]; reminders: ReminderRow[]; tz: string };
}) {
  const visibleBuckets: Bucket[] =
    filter === "all" ? ["overdue", "today", "upcoming", "someday"] : [filter];
  const visibleCount = visibleBuckets.reduce((n, b) => n + buckets[b].length, 0);
  if (visibleCount === 0) {
    return <p className="text-muted-foreground px-2 pb-1 text-xs">No open tasks.</p>;
  }

  return (
    <div className="grid gap-2">
      {visibleBuckets.map(
        (b) =>
          buckets[b].length > 0 && (
            <div key={b}>
              <p
                className={cn(
                  "text-muted-foreground mb-0.5 px-2 text-[10px] font-medium tracking-wide uppercase",
                  b === "overdue" && "text-destructive",
                )}
              >
                {BUCKET_LABELS[b]}
              </p>
              <div className="stagger-children grid gap-0.5">
                {buckets[b].map((t) => (
                  <TaskItem
                    key={t.id}
                    householdId={householdId}
                    task={t}
                    tz={tz}
                    list={listByTask.get(t.id)}
                    links={taskLinks(t, linkCtx)}
                  />
                ))}
              </div>
            </div>
          ),
      )}
    </div>
  );
}

export function TasksTab({
  householdId,
  tz,
  members,
  tasks,
  lists,
  events,
  reminders,
}: {
  householdId: string;
  tz: string;
  members: MemberRow[];
  tasks: TaskRow[];
  lists: ListRow[];
  events: EventRow[];
  reminders: ReminderRow[];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<"list" | "calendar">("list");
  const addTask = useAction(householdId);
  const reopen = useAction(householdId);
  const complete = useAction(householdId);

  const open = tasks.filter((t) => t.status === "open");
  const done = tasks.filter((t) => t.status === "done");
  const recentDone = done.slice(-5).reverse();

  const today = localDate(new Date(), tz);
  const bucketOf = (t: TaskRow): Bucket => {
    if (!t.due_at) return "someday";
    if (isOverdue(t.due_at)) return "overdue";
    return localDate(new Date(t.due_at), tz) === today ? "today" : "upcoming";
  };

  const buckets: Record<Bucket, TaskRow[]> = { overdue: [], today: [], upcoming: [], someday: [] };
  for (const t of open) buckets[bucketOf(t)].push(t);
  const listByTask = new Map(
    lists.filter((l): l is ListRow & { task_id: string } => Boolean(l.task_id)).map((l) => [l.task_id, l])
  );
  const dueDates = open
    .filter((t) => t.due_at)
    .map((t) => new Date(t.due_at!));

  const overdueCount = open.filter((t) => bucketOf(t) === "overdue").length;
  const todayCount = open.filter((t) => bucketOf(t) === "today").length;

  const tracked = open.length + done.length;
  const pct = tracked === 0 ? 0 : Math.round((done.length / tracked) * 100);

  const filterChip = (value: Filter, label: string) => (
    <button
      type="button"
      onClick={() => setFilter(value)}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs transition-colors md:px-2.5 md:py-0.5",
        filter === value
          ? "bg-primary text-primary-foreground border-primary"
          : "text-muted-foreground hover:bg-muted border-input",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="grid gap-4">
      <CreateSurface title="Add a task" triggerLabel="Add a task">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const fd = new FormData(form);
              const title = String(fd.get("title") ?? "").trim();
              if (!title) return;
              const rrule = String(fd.get("rrule") ?? "") || null;
              const dueAt = localToIso(String(fd.get("due_at") ?? ""), tz);
              const remindAt = localToIso(String(fd.get("remind_at") ?? ""), tz);
              const eventId = String(fd.get("event_id") ?? "") || null;
              const listId = String(fd.get("list_id") ?? "") || null;
              void addTask
                .run(() => {
                  if (rrule && !dueAt) {
                    return Promise.reject(new Error("A repeating task needs a due date for its first occurrence"));
                  }
                  return api.tasks.create(householdId, {
                    title,
                    assigneeMemberId: String(fd.get("assignee_id") ?? "") || null,
                    dueAt,
                    rrule,
                    eventId,
                    listId,
                    reminder: remindAt
                      ? {
                          fireAt: remindAt,
                          rrule: fd.get("until_done") === "on" ? "FREQ=HOURLY;INTERVAL=4" : null,
                          untilCompleted: fd.get("until_done") === "on",
                        }
                      : undefined,
                  });
                })
                .then((ok) => ok && form.reset());
            }}
            className="grid gap-3"
          >
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Input name="title" placeholder="Pick up the dry cleaning" required />
              <select name="assignee_id" className={selectClass + " sm:w-40"} defaultValue="">
                <option value="">Anyone</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-[auto_auto_auto]">
              <DateTimePicker name="due_at" timeZone={tz} placeholder="Due date (optional)" />
              <RecurrencePicker name="rrule" />
              <SubmitButton pending={addTask.pending}>Add</SubmitButton>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ArtifactSelect
                name="event_id"
                label="Link to event"
                emptyLabel="No event"
                options={events.map((event) => ({ id: event.id, title: event.title }))}
              />
              <ArtifactSelect
                name="list_id"
                label="Link to list"
                emptyLabel="No list"
                options={lists.map((list) => ({ id: list.id, title: list.name }))}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <DateTimePicker name="remind_at" timeZone={tz} placeholder="Remind at (optional)" />
              <label className="text-muted-foreground flex items-center gap-2 text-xs">
                <input type="checkbox" name="until_done" className="size-4" />
                Repeat until done
              </label>
            </div>
            <p className="text-muted-foreground text-xs">
              A due date is the deadline — it does not nag on its own. Add a reminder when you want
              Fambot to ping you (optionally until the task is done).
            </p>
          </form>
      </CreateSurface>

      <Card className="animate-fade-up" style={{ animationDelay: "80ms" }}>
        <CardHeader>
          <div className="flex items-baseline justify-between">
            <CardTitle className="font-serif text-lg">Open ({open.length})</CardTitle>
            {tracked > 0 && (
              <span className="text-muted-foreground text-xs">
                {done.length} of {tracked} done · {pct}%
              </span>
            )}
          </div>
          {tracked > 0 && (
            <div className="bg-secondary mt-2 h-1.5 w-full overflow-hidden rounded-full">
              <div
                className="bg-chart-1 h-full rounded-full transition-[width] duration-700"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {filterChip("all", "All")}
            {filterChip("overdue", `Overdue (${overdueCount})`)}
            {filterChip("today", `Today (${todayCount})`)}
            <span className="ml-auto flex gap-1">
              <button
                type="button"
                onClick={() => setView("list")}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs md:px-2.5 md:py-0.5",
                  view === "list" ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground border-input"
                )}
              >
                List
              </button>
              <button
                type="button"
                onClick={() => setView("calendar")}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs md:px-2.5 md:py-0.5",
                  view === "calendar" ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground border-input"
                )}
              >
                Calendar
              </button>
            </span>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {open.length === 0 && <RobotEmptyState caption="Nothing to do. Enjoy the calm." />}
          {open.length > 0 && view === "list" && (
            <BucketSection
              householdId={householdId}
              tz={tz}
              buckets={buckets}
              filter={filter}
              listByTask={listByTask}
              linkCtx={{ lists, events, reminders, tz }}
            />
          )}
          {open.length > 0 && view === "calendar" && (
            <div className="grid gap-4 md:grid-cols-[auto_1fr]">
              <Calendar
                mode="single"
                modifiers={{ hasDue: dueDates }}
                modifiersClassNames={{
                  hasDue:
                    "relative after:pointer-events-none after:absolute after:bottom-1 after:left-1/2 after:z-10 after:h-1 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-chart-1 after:content-['']",
                }}
                className="mx-auto rounded-lg border"
              />
              <div className="grid gap-1">
                {open
                  .filter((t) => t.due_at)
                  .sort((a, b) => a.due_at!.localeCompare(b.due_at!))
                  .map((t) => (
                    <div key={t.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-muted-foreground w-28 shrink-0 text-xs">{fmtWhen(t.due_at, tz)}</span>
                      <ArtifactLink type="task" id={t.id} className="min-w-0 flex-1">
                        {t.title}
                      </ArtifactLink>
                      <ArtifactLinkChips householdId={householdId} links={taskLinks(t, { lists, events, reminders, tz })} />
                      <CompleteTaskButton
                        onComplete={() => void complete.run(() => api.tasks.patch(householdId, t.id, { status: "done" }))}
                        pending={complete.pending}
                      />
                    </div>
                  ))}
              </div>
            </div>
          )}
          {recentDone.length > 0 && (
            <>
              <Separator />
              <div className="grid gap-0.5">
                {recentDone.map((t) => (
                  <div key={t.id} className="text-muted-foreground flex items-center gap-3 px-2 py-1">
                    <span className="text-chart-1 text-sm" aria-hidden>
                      &#10003;
                    </span>
                    <span className="flex-1 text-sm line-through">{t.title}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={() => reopen.run(() => api.tasks.patch(householdId, t.id, { status: "open" }))}
                      className="h-6 text-xs"
                    >
                      Reopen
                    </Button>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

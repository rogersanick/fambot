import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SubmitButton } from "@/components/submit-button";
import { AsciiEmptyState } from "@/components/ascii/ascii-empty-state";
import { MemberAvatar } from "./member-avatar";
import { fmtWhen, isOverdue, localDate } from "@/lib/format";
import { api, localToIso } from "@/lib/api";
import { useAction } from "./use-actions";
import type { ListRow, MemberRow, TaskRow } from "./types";
import { cn } from "@/lib/utils";

const selectClass =
  "border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none";

type Bucket = "overdue" | "today" | "upcoming" | "someday";
type Filter = "all" | "overdue" | "today";

const BUCKET_LABELS: Record<Bucket, string> = {
  overdue: "Overdue",
  today: "Today",
  upcoming: "Upcoming",
  someday: "Someday",
};

function TaskItem({ householdId, task, tz }: { householdId: string; task: TaskRow; tz: string }) {
  const overdue = isOverdue(task.due_at);
  const { run } = useAction(householdId);
  return (
    <div className="group hover:bg-muted/50 flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors">
      <Button
        variant="outline"
        size="sm"
        type="button"
        onClick={() => run(() => api.tasks.patch(householdId, task.id, { status: "done" }))}
        className="hover:bg-chart-1 hover:text-primary-foreground hover:border-chart-1 h-6 w-6 rounded-full p-0 transition-all hover:scale-110"
        title="Mark done"
      >
        &#10003;
      </Button>
      <span className="flex-1 text-sm">{task.title}</span>
      {task.assignee && (
        <span className="flex items-center gap-1.5" title={task.assignee.display_name}>
          <MemberAvatar name={task.assignee.display_name} size="sm" />
        </span>
      )}
      {task.due_at && (
        <span className={cn("text-xs", overdue ? "text-destructive font-medium" : "text-muted-foreground")}>
          {fmtWhen(task.due_at, tz)}
        </span>
      )}
      <Button
        variant="ghost"
        size="sm"
        type="button"
        onClick={() => run(() => api.tasks.patch(householdId, task.id, { status: "cancelled" }))}
        className="text-muted-foreground h-6 w-6 p-0 opacity-0 transition-opacity group-hover:opacity-100"
        title="Cancel"
      >
        &times;
      </Button>
    </div>
  );
}

function ListSection({
  householdId,
  tz,
  list,
  buckets,
  filter,
  openCount,
}: {
  householdId: string;
  tz: string;
  /** null = the General list (no rename/delete). */
  list: ListRow | null;
  buckets: Record<Bucket, TaskRow[]>;
  filter: Filter;
  openCount: number;
}) {
  const [renaming, setRenaming] = useState(false);
  const { run } = useAction(householdId);
  const visibleBuckets: Bucket[] =
    filter === "all" ? ["overdue", "today", "upcoming", "someday"] : [filter];
  const visibleCount = visibleBuckets.reduce((n, b) => n + buckets[b].length, 0);
  if (filter !== "all" && visibleCount === 0) return null;

  return (
    <div>
      <div className="group/list mb-1 flex items-center gap-2 px-2">
        {list && renaming ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
              if (name) void run(() => api.lists.rename(householdId, list.id, name));
              setRenaming(false);
            }}
            className="flex items-center gap-2"
          >
            <Input name="name" defaultValue={list.name} autoFocus className="h-7 w-44 text-sm" />
            <Button variant="outline" size="sm" type="submit" className="h-7 text-xs">
              Save
            </Button>
            <Button variant="ghost" size="sm" type="button" className="h-7 text-xs" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <>
            <p className="font-serif text-sm">{list?.name ?? "General"}</p>
            <span className="text-muted-foreground text-xs">{openCount}</span>
            {list && (
              <span className="flex items-center opacity-0 transition-opacity group-hover/list:opacity-100">
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  className="text-muted-foreground h-6 w-6 p-0"
                  title="Rename list"
                  onClick={() => setRenaming(true)}
                >
                  &#9998;
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => run(() => api.lists.remove(householdId, list.id))}
                  className="text-muted-foreground h-6 w-6 p-0"
                  title="Delete list (its todos move to General)"
                >
                  &times;
                </Button>
              </span>
            )}
          </>
        )}
      </div>
      {visibleCount === 0 ? (
        <p className="text-muted-foreground px-2 pb-1 text-xs">No open todos.</p>
      ) : (
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
                      <TaskItem key={t.id} householdId={householdId} task={t} tz={tz} />
                    ))}
                  </div>
                </div>
              ),
          )}
        </div>
      )}
    </div>
  );
}

export function TodosTab({
  householdId,
  tz,
  members,
  tasks,
  lists,
}: {
  householdId: string;
  tz: string;
  members: MemberRow[];
  tasks: TaskRow[];
  lists: ListRow[];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const addTask = useAction(householdId);
  const addList = useAction(householdId);
  const reopen = useAction(householdId);

  const open = tasks.filter((t) => t.status === "open");
  const done = tasks.filter((t) => t.status === "done");
  const recentDone = done.slice(-5).reverse();

  const today = localDate(new Date(), tz);
  const bucketOf = (t: TaskRow): Bucket => {
    if (!t.due_at) return "someday";
    if (isOverdue(t.due_at)) return "overdue";
    return localDate(new Date(t.due_at), tz) === today ? "today" : "upcoming";
  };

  const emptyBuckets = (): Record<Bucket, TaskRow[]> => ({ overdue: [], today: [], upcoming: [], someday: [] });
  const groups = [
    { list: null as ListRow | null, buckets: emptyBuckets(), openCount: 0 },
    ...lists.map((l) => ({ list: l as ListRow | null, buckets: emptyBuckets(), openCount: 0 })),
  ];
  const groupByListId = new Map(groups.map((g) => [g.list?.id ?? null, g]));
  for (const t of open) {
    const group = groupByListId.get(t.list_id) ?? groups[0]!;
    group.buckets[bucketOf(t)].push(t);
    group.openCount++;
  }

  const overdueCount = open.filter((t) => bucketOf(t) === "overdue").length;
  const todayCount = open.filter((t) => bucketOf(t) === "today").length;

  const tracked = open.length + done.length;
  const pct = tracked === 0 ? 0 : Math.round((done.length / tracked) * 100);

  const filterChip = (value: Filter, label: string) => (
    <button
      type="button"
      onClick={() => setFilter(value)}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
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
      <Card className="animate-fade-up">
        <CardHeader>
          <CardTitle className="font-serif text-lg">Add a todo</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const fd = new FormData(form);
              const title = String(fd.get("title") ?? "").trim();
              if (!title) return;
              void addTask
                .run(() =>
                  api.tasks.create(householdId, {
                    title,
                    listId: String(fd.get("list_id") ?? "") || null,
                    assigneeMemberId: String(fd.get("assignee_id") ?? "") || null,
                    dueAt: localToIso(String(fd.get("due_at") ?? ""), tz),
                  })
                )
                .then((ok) => ok && form.reset());
            }}
            className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto_auto]"
          >
            <Input name="title" placeholder="Pick up the dry cleaning" required />
            <select name="list_id" className={selectClass + " sm:w-36"} defaultValue="">
              <option value="">General</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <select name="assignee_id" className={selectClass + " sm:w-40"} defaultValue="">
              <option value="">Anyone</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
            </select>
            <Input name="due_at" type="datetime-local" className="sm:w-52" />
            <SubmitButton pending={addTask.pending}>Add</SubmitButton>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const name = String(new FormData(form).get("name") ?? "").trim();
              if (!name) return;
              void addList.run(() => api.lists.create(householdId, name)).then((ok) => ok && form.reset());
            }}
            className="flex items-center gap-2"
          >
            <Input name="name" placeholder="New list (e.g. Costco)" className="h-8 w-56 text-sm" required />
            <Button variant="outline" size="sm" type="submit" className="h-8 text-xs">
              Create list
            </Button>
          </form>
        </CardContent>
      </Card>

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
          <div className="mt-2 flex items-center gap-1.5">
            {filterChip("all", "All")}
            {filterChip("overdue", `Overdue (${overdueCount})`)}
            {filterChip("today", `Today (${todayCount})`)}
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {open.length === 0 && <AsciiEmptyState variant="sprout" caption="Nothing to do. Enjoy the calm." />}
          {open.length > 0 &&
            groups.map((g) => (
              <ListSection
                key={g.list?.id ?? "general"}
                householdId={householdId}
                tz={tz}
                list={g.list}
                buckets={g.buckets}
                filter={filter}
                openCount={g.openCount}
              />
            ))}
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

import { notFound } from "next/navigation";
import { getHousehold } from "@/lib/household";
import { createClient } from "@/lib/supabase/server";
import { fmtWhen } from "@/lib/format";
import { setTaskStatus, updateTask } from "../../actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

function toLocalInput(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ slug: string; code: string }>;
}) {
  const { slug, code } = await params;
  const household = await getHousehold(slug);
  const tz = household.timezone ?? "UTC";
  const supabase = await createClient();

  const [{ data: task }, { data: members }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, short_code, title, notes, status, due_at, assignee_member_id, created_at, completed_at, cancelled_at")
      .eq("household_id", household.id)
      .eq("short_code", code)
      .maybeSingle(),
    supabase.from("members").select("id, display_name, normalized_handle").is("removed_at", null),
  ]);
  if (!task) notFound();

  const isCancelled = task.status === "cancelled";
  const isDone = task.status === "done";

  return (
    <div className="mx-auto grid max-w-xl gap-4">
      {isCancelled && (
        <div className="rounded-md border border-dashed bg-muted px-4 py-3 text-sm text-muted-foreground">
          This task was deleted{task.cancelled_at ? ` on ${fmtWhen(task.cancelled_at, tz)}` : ""}. It&apos;s kept
          here for reference.
        </div>
      )}

      <Card className={isCancelled ? "opacity-70" : ""}>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <CardTitle className={isCancelled ? "line-through" : ""}>{task.title}</CardTitle>
          <Badge
            variant={task.status === "open" ? "default" : task.status === "done" ? "secondary" : "outline"}
            className="capitalize"
          >
            {task.status}
          </Badge>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1 text-sm text-muted-foreground">
            {task.due_at && <span>Due: {fmtWhen(task.due_at, tz)}</span>}
            {task.completed_at && <span>Completed: {fmtWhen(task.completed_at, tz)}</span>}
            <span>Created: {fmtWhen(task.created_at, tz)}</span>
            {task.notes && <span className="text-foreground">{task.notes}</span>}
          </div>

          <div className="flex flex-wrap gap-2">
            {!isCancelled && (
              <form action={setTaskStatus}>
                <input type="hidden" name="task_id" value={task.id} />
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="status" value={isDone ? "open" : "done"} />
                <Button type="submit" variant={isDone ? "outline" : "default"}>
                  {isDone ? "Reopen" : "✓ Mark done"}
                </Button>
              </form>
            )}
            <form action={setTaskStatus}>
              <input type="hidden" name="task_id" value={task.id} />
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="status" value={isCancelled ? "open" : "cancelled"} />
              <Button type="submit" variant={isCancelled ? "outline" : "destructive"}>
                {isCancelled ? "Restore" : "Delete"}
              </Button>
            </form>
          </div>

          {!isCancelled && (
            <>
              <Separator />
              <form action={updateTask} className="grid gap-4">
                <input type="hidden" name="task_id" value={task.id} />
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="code" value={task.short_code} />
                <div className="grid gap-2">
                  <Label htmlFor="title">Title</Label>
                  <Input id="title" name="title" defaultValue={task.title} required />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="assignee_member_id">Assignee</Label>
                  <select
                    id="assignee_member_id"
                    name="assignee_member_id"
                    defaultValue={task.assignee_member_id ?? "none"}
                    className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                  >
                    <option value="none">Anyone</option>
                    {(members ?? []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.display_name ?? m.normalized_handle}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="due_at">Due</Label>
                  <Input
                    id="due_at"
                    name="due_at"
                    type="datetime-local"
                    defaultValue={toLocalInput(task.due_at, tz)}
                  />
                </div>
                <Button type="submit" variant="outline">
                  Save changes
                </Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

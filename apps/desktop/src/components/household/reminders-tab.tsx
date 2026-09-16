import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateSurface } from "./create-surface";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SubmitButton } from "@/components/submit-button";
import { DateTimePicker } from "@/components/date-time-picker";
import { RobotEmptyState } from "@/components/robot/scenes";
import { api, localToIso } from "@/lib/api";
import { useAction } from "./use-actions";
import { fmtWhen } from "@/lib/format";
import { ArtifactLink } from "./artifact-link";
import { ArtifactLinkChips, ArtifactParentSelect, parseParentValue, parentValue, reminderLinks } from "./artifact-links";
import type { EventRow, ReminderRow, TaskRow } from "./types";
import { cn } from "@/lib/utils";

export function RemindersTab({
  householdId,
  tz,
  reminders,
  tasks,
  events,
}: {
  householdId: string;
  tz: string;
  reminders: ReminderRow[];
  tasks: TaskRow[];
  events: EventRow[];
}) {
  const create = useAction(householdId);
  const cancel = useAction(householdId);
  const link = useAction(householdId);
  const pending = reminders.filter((r) => r.status === "pending");
  const past = reminders.filter((r) => r.status !== "pending").slice(0, 5);

  return (
    <div className="grid gap-4">
      <CreateSurface
        title="Schedule a reminder"
        description="Delivered by text message (and iMessage when enabled) — manage channels in Connections. You can also tell Fambot in Chat."
        triggerLabel="Schedule a reminder"
      >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const fd = new FormData(form);
              const title = String(fd.get("message") ?? "").trim();
              const fireAt = localToIso(String(fd.get("fire_at") ?? ""), tz);
              if (!title || !fireAt) return;
              const parent = parseParentValue(String(fd.get("parent") ?? ""));
              void create
                .run(() =>
                  api.reminders.create(householdId, {
                    title,
                    fireAt,
                    taskId: parent.taskId,
                    eventId: parent.eventId,
                    untilCompleted: parent.taskId ? fd.get("until_done") === "on" : false,
                    rrule: parent.taskId && fd.get("until_done") === "on" ? "FREQ=HOURLY;INTERVAL=4" : null,
                  })
                )
                .then((ok) => ok && form.reset());
            }}
            className="grid gap-3"
          >
            <Input name="message" placeholder="Take out the trash tonight!" required />
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <DateTimePicker name="fire_at" timeZone={tz} placeholder="When should it fire?" required />
              <SubmitButton pending={create.pending}>Schedule</SubmitButton>
            </div>
            <ArtifactParentSelect
              tasks={tasks.filter((task) => task.status === "open").map((task) => ({ id: task.id, title: task.title }))}
              events={events.map((event) => ({ id: event.id, title: event.title }))}
            />
            <label className="text-muted-foreground flex items-center gap-2 text-xs">
              <input type="checkbox" name="until_done" className="size-4" />
              If linked to a task, repeat every 4 hours until it’s done
            </label>
          </form>
      </CreateSurface>

      <Card className="animate-fade-up" style={{ animationDelay: "80ms" }}>
        <CardHeader>
          <CardTitle className="font-serif text-lg">Pending ({pending.length})</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {pending.length === 0 && <RobotEmptyState caption="No reminders pending. Silence is golden." />}
          {pending.length > 0 && (
            <div className="stagger-children border-border ml-2 grid border-l-2">
              {pending.map((r, i) => (
                <div key={r.id} className="group relative py-2 pl-5">
                  <span
                    className={cn(
                      "bg-chart-2 ring-background absolute top-3.5 -left-[5px] h-2 w-2 rounded-full ring-2",
                      i === 0 && "animate-gentle-pulse",
                    )}
                    aria-hidden
                  />
                  <div className="hover:bg-muted/50 -my-1 flex items-center gap-3 rounded-md px-2 py-1 transition-colors">
                    <div className="min-w-0 flex-1">
                      <ArtifactLink type="reminder" id={r.id} className="text-sm">
                        {r.message}
                      </ArtifactLink>
                      {r.parent ? (
                        <ArtifactLinkChips links={reminderLinks(r)} />
                      ) : (
                        <p className="text-muted-foreground text-[11px]">One-off</p>
                      )}
                      {r.status === "pending" && (
                        <div className="mt-1 max-w-sm">
                          <ArtifactParentSelect
                            label="Link to"
                            tasks={tasks
                              .filter((task) => task.status === "open" || r.parent?.id === task.id)
                              .map((task) => ({ id: task.id, title: task.title }))}
                            events={events.map((event) => ({ id: event.id, title: event.title }))}
                            value={parentValue(
                              r.parent?.type === "task" ? r.parent.id : null,
                              r.parent?.type === "event" ? r.parent.id : null
                            )}
                            onChange={(value) => {
                              const parent = parseParentValue(value);
                              void link.run(() => api.reminders.patch(householdId, r.id, parent));
                            }}
                          />
                        </div>
                      )}
                    </div>
                    {r.recurring && (
                      <Badge variant="outline" className="text-[10px]">
                        {r.until_completed ? "until done" : "recurring"}
                      </Badge>
                    )}
                    <span className="text-muted-foreground text-xs">{fmtWhen(r.fire_at, tz)}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={() => cancel.run(() => api.reminders.cancel(householdId, r.id))}
                      className="text-muted-foreground h-8 w-8 p-0 opacity-100 transition-opacity md:h-6 md:w-6 md:opacity-0 md:group-hover:opacity-100"
                      title="Cancel"
                    >
                      &times;
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {past.length > 0 && (
            <>
              <Separator />
              <div className="grid gap-0.5">
                {past.map((r) => (
                  <div key={r.id} className="text-muted-foreground flex flex-col gap-0.5 px-2 py-1">
                    <div className="flex items-center gap-3">
                      <ArtifactLink type="reminder" id={r.id} className="flex-1 text-sm">
                        {r.message}
                      </ArtifactLink>
                      <Badge
                        variant="outline"
                        className={cn(r.status === "sent" && "border-chart-1/40 text-chart-1")}
                      >
                        {r.status}
                      </Badge>
                    </div>
                    <ArtifactLinkChips links={reminderLinks(r)} />
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

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ArtifactRef } from "@fambot/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { ArtifactPreviewCard } from "@/components/household/artifact-preview-card";
import { goHome } from "@/components/household/artifact-link";
import {
  ArtifactLinkChips,
  ArtifactParentSelect,
  ArtifactSelect,
  eventLinks,
  listEventLinkPatches,
  listLinks,
  parentValue,
  parseParentValue,
  reminderLinks,
  taskLinks,
} from "@/components/household/artifact-links";
import { CompleteTaskButton } from "@/components/household/complete-task-button";
import { ChatPanel } from "@/components/household/chat-panel";
import { CommentThread } from "@/components/household/comment-thread";
import { SnoozeMenu } from "@/components/snooze-menu";
import { RobotSpinner } from "@/components/robot/spinner";
import { useAction } from "@/components/household/use-actions";
import { toEventRows, toListRows, toReminderRows, toTaskRows } from "@/components/household/types";
import { api, ApiError, type ArtifactPreview } from "@/lib/api";
import { fmtWhen } from "@/lib/format";
import { useIsMobile, useKeyboardOffset } from "@/lib/use-mobile";
import { cn } from "@/lib/utils";

export function ArtifactScreen({
  householdId,
  artifact,
  meName,
}: {
  householdId: string;
  artifact: ArtifactRef;
  meName: string;
}) {
  const isMobile = useIsMobile();
  const keyboardOffset = useKeyboardOffset();
  const queryClient = useQueryClient();
  const [sending, setSending] = useState(false);
  const action = useAction(householdId);

  const previewQ = useQuery({
    queryKey: ["artifact-preview", artifact.type, artifact.id],
    queryFn: () => api.artifacts.preview(artifact.type, artifact.id).then((row) => row.artifact),
  });
  const config = useQuery({
    queryKey: ["config"],
    queryFn: api.config,
    refetchInterval: 10_000,
  });
  const bundle = useQuery({
    queryKey: ["household", householdId],
    queryFn: () => api.household(householdId),
  });
  const tasksQ = useQuery({
    queryKey: ["household", householdId, "tasks"],
    queryFn: () => api.tasks.list(householdId),
  });
  const eventsQ = useQuery({
    queryKey: ["household", householdId, "events"],
    queryFn: () => api.events.list(householdId),
  });
  const remindersQ = useQuery({
    queryKey: ["household", householdId, "reminders"],
    queryFn: () => api.reminders.list(householdId),
  });
  const chat = useQuery({
    queryKey: ["household", householdId, "item-chat", artifact.type, artifact.id],
    queryFn: () => api.artifacts.chat.get(householdId, artifact.type, artifact.id),
    refetchInterval: 3_000,
    retry: (count, error) => !(error instanceof ApiError && (error.status === 403 || error.status === 404)),
  });

  const tz = bundle.data?.household.timezone ?? previewQ.data?.timezone ?? "UTC";
  const members = bundle.data?.members ?? [];
  const tasks = tasksQ.data ? toTaskRows(tasksQ.data.tasks, members, tasksQ.data.series) : [];
  const events = eventsQ.data ? toEventRows(eventsQ.data.events) : [];
  const reminders = remindersQ.data
    ? toReminderRows(remindersQ.data.reminders, {
        tasks: tasksQ.data?.tasks,
        events: eventsQ.data?.events,
      })
    : [];
  const lists = tasksQ.data ? toListRows(tasksQ.data.lists) : [];
  const task = tasks.find((row) => row.id === artifact.id);
  const reminder = reminders.find((row) => row.id === artifact.id);
  const event = events.find((row) => row.id === artifact.id);
  const list = lists.find((row) => row.id === artifact.id);

  const preview = previewQ.data;
  const missing = previewQ.isError && previewQ.error instanceof ApiError && previewQ.error.status === 404;

  async function send(text: string) {
    setSending(true);
    try {
      await api.artifacts.chat.send(householdId, artifact.type, artifact.id, text);
      await queryClient.invalidateQueries({ queryKey: ["household", householdId] });
      await queryClient.invalidateQueries({ queryKey: ["artifact-preview", artifact.type, artifact.id] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSending(false);
    }
  }

  return (
    <main
      className={cn(
        "mx-auto flex w-full max-w-5xl flex-col",
        isMobile ? "h-dvh overflow-hidden px-4" : "min-h-svh p-4 sm:p-6"
      )}
      style={
        isMobile
          ? { paddingTop: "env(safe-area-inset-top)", paddingBottom: keyboardOffset }
          : undefined
      }
    >
      <header className={cn("flex items-center justify-between", isMobile ? "shrink-0 py-3" : "mb-5")}>
        <div className="min-w-0">
          <Button variant="ghost" size="sm" className="-ml-2" onClick={goHome}>
            ← Household
          </Button>
          <h1 className={cn("font-serif", isMobile ? "truncate text-xl" : "text-3xl")}>
            {preview?.title ?? "Item"}
          </h1>
        </div>
        <ThemeToggle />
      </header>

      {missing ? (
        <Card>
          <CardHeader>
            <CardTitle className="font-serif">This item is gone</CardTitle>
            <CardDescription>It may have been deleted. Head back to the household dashboard.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={goHome}>Back to household</Button>
          </CardContent>
        </Card>
      ) : (
        <div
          className={cn(
            isMobile ? "flex min-h-0 flex-1 flex-col gap-3" : "grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
          )}
        >
          <div className={cn(isMobile && "shrink-0")}>
            {preview ? (
              <ArtifactDetail
                householdId={householdId}
                tz={tz}
                preview={preview}
                task={task}
                reminder={reminder}
                event={event}
                list={list}
                lists={lists}
                events={events}
                tasks={tasks}
                reminders={reminders}
                onAction={action.run}
              />
            ) : (
              <div className="text-muted-foreground flex items-center gap-2 font-mono text-sm">
                <RobotSpinner /> loading item…
              </div>
            )}
          </div>
          <div className={cn(isMobile && "flex min-h-0 flex-1 flex-col")}>
            <ChatPanel
              meName={meName}
              messages={chat.data?.messages ?? []}
              online={config.data?.aiConfigured === true}
              sending={sending}
              fillViewport={isMobile}
              loading={chat.isLoading}
              header="edit --this"
              emptyCaption="Prompt-edit this item — try “move it to Friday” or “rename this”."
              placeholder="Change the time, rename it, mark it done…"
              onSend={send}
            />
          </div>
        </div>
      )}
    </main>
  );
}

function ArtifactDetail({
  householdId,
  tz,
  preview,
  task,
  reminder,
  event,
  list,
  lists,
  events,
  tasks,
  reminders,
  onAction,
}: {
  householdId: string;
  tz: string;
  preview: ArtifactPreview;
  task?: ReturnType<typeof toTaskRows>[number];
  reminder?: ReturnType<typeof toReminderRows>[number];
  event?: ReturnType<typeof toEventRows>[number];
  list?: ReturnType<typeof toListRows>[number];
  lists: ReturnType<typeof toListRows>;
  events: ReturnType<typeof toEventRows>;
  tasks: ReturnType<typeof toTaskRows>;
  reminders: ReturnType<typeof toReminderRows>;
  onAction: (fn: () => Promise<unknown>) => Promise<boolean>;
}) {
  const taskLists = task ? lists.filter((row) => row.task_id === task.id) : [];
  const eventLists = event ? lists.filter((row) => row.event_id === event.id) : [];

  if (preview.type === "task" && task) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline">Task</Badge>
            <Badge variant="secondary">{task.status}</Badge>
          </div>
          <CardTitle className="font-serif text-xl">{task.title}</CardTitle>
          <CardDescription>
            {task.due_at ? fmtWhen(task.due_at, tz) : "No due date"}
            {task.assignee ? ` · ${task.assignee.display_name}` : ""}
            {task.recurrence ? ` · repeats ${task.recurrence}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <ArtifactLinkChips householdId={householdId} links={taskLinks(task, { lists, events, reminders, tz })} />
          {taskLists.map((owned) =>
            owned.items.length > 0 ? (
              <div key={owned.id} className="grid gap-1">
                <p className="text-muted-foreground text-xs uppercase">{owned.name}</p>
                {owned.items.map((item) => (
                  <span
                    key={item.id}
                    className={item.completed_at ? "text-muted-foreground text-sm line-through" : "text-sm"}
                  >
                    {item.completed_at ? "✓" : "○"} {item.body}
                  </span>
                ))}
              </div>
            ) : null
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <ArtifactSelect
              label="Linked event"
              emptyLabel="No event"
              options={events.map((row) => ({ id: row.id, title: row.title }))}
              value={task.event_id ?? ""}
              onChange={(id) => void onAction(() => api.tasks.patch(householdId, task.id, { eventId: id || null }))}
            />
            <ArtifactSelect
              label="Linked list"
              emptyLabel="No list"
              options={lists.map((row) => ({ id: row.id, title: row.name }))}
              value={taskLists[0]?.id ?? ""}
              onChange={(id) =>
                void onAction(async () => {
                  const current = taskLists[0];
                  if (current && current.id !== id) {
                    await api.lists.patch(householdId, current.id, { taskId: null });
                  }
                  if (id) await api.lists.patch(householdId, id, { taskId: task.id });
                })
              }
            />
          </div>
          <div className="flex flex-wrap gap-2">
          {task.status === "open" && (
            <CompleteTaskButton
              onComplete={() => void onAction(() => api.tasks.patch(householdId, task.id, { status: "done" }))}
            />
          )}
          {task.due_at && (
            <SnoozeMenu
              tz={tz}
              isRecurring={Boolean(task.series_id)}
              onPostpone={(iso) => void onAction(() => api.tasks.patch(householdId, task.id, { dueAt: iso }))}
              onStopRepeating={
                task.series_id
                  ? () => void onAction(() => api.taskSeries.cancel(householdId, task.series_id!))
                  : undefined
              }
            />
          )}
          </div>
          <CommentThread
            variant="full"
            householdId={householdId}
            tz={tz}
            subject="task"
            subjectId={task.id}
          />
        </CardContent>
      </Card>
    );
  }

  if (preview.type === "reminder" && reminder) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline">Reminder</Badge>
            <Badge variant="secondary">{reminder.status}</Badge>
          </div>
          <CardTitle className="font-serif text-xl">{reminder.message}</CardTitle>
          <CardDescription>
            {fmtWhen(reminder.fire_at, tz)}
            {reminder.recurring ? (reminder.until_completed ? " · until done" : " · recurring") : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <ArtifactLinkChips links={reminderLinks(reminder)} />
          {reminder.status === "pending" && (
            <ArtifactParentSelect
              tasks={tasks
                .filter((row) => row.status === "open" || reminder.parent?.id === row.id)
                .map((row) => ({ id: row.id, title: row.title }))}
              events={events.map((row) => ({ id: row.id, title: row.title }))}
              value={parentValue(
                reminder.parent?.type === "task" ? reminder.parent.id : null,
                reminder.parent?.type === "event" ? reminder.parent.id : null
              )}
              onChange={(value) => {
                const parent = parseParentValue(value);
                void onAction(() => api.reminders.patch(householdId, reminder.id, parent));
              }}
            />
          )}
          {reminder.status === "pending" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void onAction(() => api.reminders.cancel(householdId, reminder.id))}
            >
              Cancel reminder
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  if (preview.type === "event" && event) {
    return (
      <Card>
        <CardHeader>
          <Badge variant="outline">Event</Badge>
          <CardTitle className="font-serif text-xl">{event.title}</CardTitle>
          <CardDescription>
            {fmtWhen(event.starts_at, tz)}
            {event.ends_at ? ` – ${fmtWhen(event.ends_at, tz)}` : ""}
            {event.location ? ` · ${event.location}` : ""}
            {event.recurrence ? ` · repeats ${event.recurrence}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {event.notes && <p className="text-sm whitespace-pre-wrap">{event.notes}</p>}
          <ArtifactLinkChips
            householdId={householdId}
            links={eventLinks(event, { tasks, lists, reminders, tz })}
          />
          <ArtifactSelect
            label="Linked list"
            emptyLabel="No list"
            options={lists.map((row) => ({ id: row.id, title: row.name }))}
            value={eventLists[0]?.id ?? ""}
            onChange={(id) =>
              void onAction(async () => {
                for (const patch of listEventLinkPatches(event.id, eventLists[0]?.id ?? null, id)) {
                  await api.lists.patch(householdId, patch.listId, { eventId: patch.eventId });
                }
              })
            }
          />
          {eventLists.map((owned) =>
            owned.items.length > 0 ? (
              <div key={owned.id} className="grid gap-1">
                <p className="text-muted-foreground text-xs uppercase">{owned.name}</p>
                {owned.items.map((item) => (
                  <span
                    key={item.id}
                    className={item.completed_at ? "text-muted-foreground text-sm line-through" : "text-sm"}
                  >
                    {item.completed_at ? "✓" : "○"} {item.body}
                  </span>
                ))}
              </div>
            ) : null
          )}
          <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void onAction(() => api.events.remove(householdId, event.id))}
          >
            Delete
          </Button>
          </div>
          <CommentThread
            variant="full"
            householdId={householdId}
            tz={tz}
            subject="event"
            subjectId={event.id}
          />
        </CardContent>
      </Card>
    );
  }

  if (preview.type === "list") {
    return (
      <Card>
        <CardHeader>
          <Badge variant="outline">List</Badge>
          <CardTitle className="font-serif text-xl">{list?.name ?? preview.title}</CardTitle>
          <CardDescription>{preview.description}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {list && <ArtifactLinkChips links={listLinks(list, { tasks, events })} />}
          {(list?.items.length ?? 0) === 0 && <p className="text-muted-foreground text-sm">No items yet.</p>}
          {list?.items.map((item) => (
            <div key={item.id} className="flex items-center gap-2 text-sm">
              <span className={item.completed_at ? "text-muted-foreground line-through" : ""}>
                {item.body}
              </span>
            </div>
          ))}
          {list && (
            <div className="grid gap-3 sm:grid-cols-2">
              <ArtifactSelect
                label="Used by task"
                emptyLabel="No task"
                options={tasks
                  .filter((row) => row.status !== "cancelled")
                  .map((row) => ({ id: row.id, title: row.title }))}
                value={list.task_id ?? ""}
                onChange={(id) => void onAction(() => api.lists.patch(householdId, list.id, { taskId: id || null }))}
              />
              <ArtifactSelect
                label="Used by event"
                emptyLabel="No event"
                options={events.map((row) => ({ id: row.id, title: row.title }))}
                value={list.event_id ?? ""}
                onChange={(id) => void onAction(() => api.lists.patch(householdId, list.id, { eventId: id || null }))}
              />
            </div>
          )}
          <CommentThread
            variant="full"
            householdId={householdId}
            tz={tz}
            subject="list"
            subjectId={preview.id}
          />
        </CardContent>
      </Card>
    );
  }

  return <ArtifactPreviewCard preview={preview} />;
}

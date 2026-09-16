import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateSurface } from "./create-surface";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/submit-button";
import { DateTimePicker } from "@/components/date-time-picker";
import { RecurrencePicker } from "@/components/recurrence-picker";
import { api, localToIso } from "@/lib/api";
import { useAction } from "./use-actions";
import { fmtTime, localDate } from "@/lib/format";
import { CalendarView } from "./calendar-view";
import { ArtifactSelect, eventLinks, withoutReminders } from "./artifact-links";
import type { EventRow, ListRow, ReminderRow, TaskRow } from "./types";

export function CalendarTab({
  householdId,
  tz,
  events,
  tasks,
  lists,
  reminders,
}: {
  householdId: string;
  tz: string;
  events: EventRow[];
  tasks: TaskRow[];
  lists: ListRow[];
  reminders: ReminderRow[];
}) {
  const create = useAction(householdId);
  const calendarEvents = events.map((e) => ({
    id: e.id,
    title: e.title,
    day: localDate(new Date(e.starts_at), tz),
    time: fmtTime(e.starts_at, tz),
    location: e.location,
    notes: e.notes,
    recurrence: e.recurrence,
    links: withoutReminders(eventLinks(e, { tasks, lists, reminders, tz })),
  }));

  return (
    <div className="grid gap-4">
      <CreateSurface
        title="Add an event"
        description="Title and description are the event. Reminders are optional attached pings, not the body."
        triggerLabel="Add an event"
      >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const fd = new FormData(form);
              const title = String(fd.get("title") ?? "").trim();
              const startsAt = localToIso(String(fd.get("starts_at") ?? ""), tz);
              if (!title || !startsAt) return;
              const remindAt = localToIso(String(fd.get("remind_at") ?? ""), tz);
              const listId = String(fd.get("list_id") ?? "") || null;
              const notes = String(fd.get("notes") ?? "").trim() || null;
              void create
                .run(() =>
                  api.events.create(householdId, {
                    title,
                    notes,
                    startsAt,
                    endsAt: localToIso(String(fd.get("ends_at") ?? ""), tz),
                    location: String(fd.get("location") ?? "").trim() || null,
                    rrule: String(fd.get("rrule") ?? "") || null,
                    listId,
                    reminder: remindAt ? { fireAt: remindAt } : undefined,
                  })
                )
                .then((ok) => ok && form.reset());
            }}
            className="grid gap-3 sm:grid-cols-2"
          >
            <Input name="title" placeholder="Soccer practice" required className="sm:col-span-2" />
            <div className="grid gap-1 sm:col-span-2">
              <Label className="text-muted-foreground text-xs">Description</Label>
              <Textarea name="notes" placeholder="Bring shin guards and water." rows={2} />
            </div>
            <div className="grid gap-1">
              <Label className="text-muted-foreground text-xs">Starts</Label>
              <DateTimePicker name="starts_at" timeZone={tz} required className="sm:w-full" />
            </div>
            <div className="grid gap-1">
              <Label className="text-muted-foreground text-xs">Ends (optional)</Label>
              <DateTimePicker name="ends_at" timeZone={tz} className="sm:w-full" />
            </div>
            <div className="grid gap-1">
              <Label className="text-muted-foreground text-xs">Repeats</Label>
              <RecurrencePicker name="rrule" className="sm:w-full" />
            </div>
            <div className="grid content-end gap-1">
              <Input name="location" placeholder="Location (optional)" />
            </div>
            <ArtifactSelect
              name="list_id"
              label="Link to list"
              emptyLabel="No list"
              options={lists.map((list) => ({ id: list.id, title: list.name }))}
            />
            <div className="grid gap-1 sm:col-span-2">
              <DateTimePicker name="remind_at" timeZone={tz} placeholder="Remind at (optional)" />
            </div>
            <SubmitButton pending={create.pending}>Add event</SubmitButton>
          </form>
      </CreateSurface>

      <Card className="animate-fade-up" style={{ animationDelay: "80ms" }}>
        <CardHeader>
          <CardTitle className="font-serif text-lg">This month</CardTitle>
        </CardHeader>
        <CardContent>
          <CalendarView
            householdId={householdId}
            tz={tz}
            events={calendarEvents}
            todayKey={localDate(new Date(), tz)}
          />
        </CardContent>
      </Card>
    </div>
  );
}

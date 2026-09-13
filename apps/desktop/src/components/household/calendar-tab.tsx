import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/submit-button";
import { DateTimePicker } from "@/components/date-time-picker";
import { RecurrencePicker } from "@/components/recurrence-picker";
import { api, localToIso } from "@/lib/api";
import { useAction } from "./use-actions";
import { fmtTime, localDate } from "@/lib/format";
import { CalendarView } from "./calendar-view";
import type { EventRow } from "./types";

export function CalendarTab({
  householdId,
  tz,
  events,
}: {
  householdId: string;
  tz: string;
  events: EventRow[];
}) {
  const create = useAction(householdId);
  const calendarEvents = events.map((e) => ({
    id: e.id,
    title: e.title,
    day: localDate(new Date(e.starts_at), tz),
    time: fmtTime(e.starts_at, tz),
    location: e.location,
    recurrence: e.recurrence,
  }));

  return (
    <div className="grid gap-4">
      <Card className="animate-fade-up">
        <CardHeader>
          <CardTitle className="font-serif text-lg">Add an event</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const fd = new FormData(form);
              const title = String(fd.get("title") ?? "").trim();
              const startsAt = localToIso(String(fd.get("starts_at") ?? ""), tz);
              if (!title || !startsAt) return;
              void create
                .run(() =>
                  api.events.create(householdId, {
                    title,
                    startsAt,
                    endsAt: localToIso(String(fd.get("ends_at") ?? ""), tz),
                    location: String(fd.get("location") ?? "").trim() || null,
                    rrule: String(fd.get("rrule") ?? "") || null,
                  })
                )
                .then((ok) => ok && form.reset());
            }}
            className="grid gap-3 sm:grid-cols-2"
          >
            <Input name="title" placeholder="Soccer practice" required className="sm:col-span-2" />
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
            <SubmitButton pending={create.pending}>Add event</SubmitButton>
          </form>
        </CardContent>
      </Card>

      <Card className="animate-fade-up" style={{ animationDelay: "80ms" }}>
        <CardHeader>
          <CardTitle className="font-serif text-lg">This month</CardTitle>
        </CardHeader>
        <CardContent>
          <CalendarView householdId={householdId} tz={tz} events={calendarEvents} todayKey={localDate(new Date(), tz)} />
        </CardContent>
      </Card>
    </div>
  );
}

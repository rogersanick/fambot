import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/submit-button";
import { createEvent } from "@/app/h/[id]/actions";
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
  const calendarEvents = events.map((e) => ({
    id: e.id,
    title: e.title,
    day: localDate(new Date(e.starts_at), tz),
    time: fmtTime(e.starts_at, tz),
    location: e.location,
  }));

  return (
    <div className="grid gap-4">
      <Card className="animate-fade-up">
        <CardHeader>
          <CardTitle className="font-serif text-lg">Add an event</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createEvent.bind(null, householdId, tz)} className="grid gap-3 sm:grid-cols-2">
            <Input name="title" placeholder="Soccer practice" required className="sm:col-span-2" />
            <div className="grid gap-1">
              <Label className="text-muted-foreground text-xs">Starts</Label>
              <Input name="starts_at" type="datetime-local" required />
            </div>
            <div className="grid gap-1">
              <Label className="text-muted-foreground text-xs">Ends (optional)</Label>
              <Input name="ends_at" type="datetime-local" />
            </div>
            <Input name="location" placeholder="Location (optional)" />
            <SubmitButton>Add event</SubmitButton>
          </form>
        </CardContent>
      </Card>

      <Card className="animate-fade-up" style={{ animationDelay: "80ms" }}>
        <CardHeader>
          <CardTitle className="font-serif text-lg">This month</CardTitle>
        </CardHeader>
        <CardContent>
          <CalendarView householdId={householdId} events={calendarEvents} todayKey={localDate(new Date(), tz)} />
        </CardContent>
      </Card>
    </div>
  );
}

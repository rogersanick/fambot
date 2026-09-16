import { useMemo, useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { RobotEmptyState } from "@/components/robot/scenes";
import { api } from "@/lib/api";
import { useAction } from "./use-actions";
import { CommentThread } from "./comment-thread";
import { ArtifactLink } from "./artifact-link";
import { ArtifactLinkChips } from "./artifact-links";
import type { CalendarEvent } from "./types";

function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function keyToDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function EventCard({
  householdId,
  tz,
  event,
}: {
  householdId: string;
  tz: string;
  event: CalendarEvent;
}) {
  const { run } = useAction(householdId);
  return (
    <article className="group hover:bg-muted/50 grid gap-1.5 rounded-md px-2 py-2.5 transition-colors">
      <div className="flex items-start gap-2 sm:gap-3">
        <span className="bg-chart-4 mt-1.5 h-2 w-2 shrink-0 rounded-full" aria-hidden />
        <span className="text-muted-foreground w-20 shrink-0 pt-0.5 text-xs">{event.time}</span>
        <div className="min-w-0 flex-1">
          <CommentThread householdId={householdId} tz={tz} subject="event" subjectId={event.id}>
            {(toggle) => (
              <>
                <div className="flex items-start gap-2">
                  <ArtifactLink type="event" id={event.id} className="min-w-0 flex-1 text-sm font-medium">
                    {event.title}
                  </ArtifactLink>
                  {event.recurrence && (
                    <span
                      className="text-muted-foreground shrink-0 rounded-full border px-1.5 py-0.5 text-[10px]"
                      title={`Repeats ${event.recurrence}`}
                    >
                      ↻ {event.recurrence}
                    </span>
                  )}
                  {toggle}
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => run(() => api.events.remove(householdId, event.id))}
                    className="text-muted-foreground h-8 w-8 shrink-0 p-0 opacity-100 transition-opacity md:h-6 md:w-6 md:opacity-0 md:group-hover:opacity-100"
                    title={event.recurrence ? "Delete series (all occurrences)" : "Delete"}
                  >
                    &times;
                  </Button>
                </div>
                {event.notes && (
                  <p className="text-muted-foreground mt-1 text-sm whitespace-pre-wrap">{event.notes}</p>
                )}
                {event.location && <p className="text-muted-foreground mt-0.5 text-xs">{event.location}</p>}
                <ArtifactLinkChips householdId={householdId} links={event.links ?? []} className="mt-1.5" />
              </>
            )}
          </CommentThread>
        </div>
      </div>
    </article>
  );
}

/** Month grid with event dots; selecting a day shows its events beside it. */
export function CalendarView({
  householdId,
  tz,
  events,
  todayKey,
}: {
  householdId: string;
  tz: string;
  events: CalendarEvent[];
  /** Today's YYYY-MM-DD in the HOUSEHOLD timezone — the browser's may differ. */
  todayKey: string;
}) {
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      if (!map.has(e.day)) map.set(e.day, []);
      map.get(e.day)!.push(e);
    }
    return map;
  }, [events]);

  const eventDates = useMemo(() => [...byDay.keys()].map(keyToDate), [byDay]);
  const [selected, setSelected] = useState<Date>(() => keyToDate(todayKey));

  const selectedKey = dayKey(selected);
  const dayEvents = byDay.get(selectedKey) ?? [];
  const selectedLabel = selected.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="grid gap-6 md:grid-cols-[auto_1fr]">
      <Calendar
        mode="single"
        required
        selected={selected}
        onSelect={(d) => d && setSelected(d)}
        modifiers={{ hasEvent: eventDates }}
        modifiersClassNames={{
          hasEvent:
            "relative after:pointer-events-none after:absolute after:bottom-1 after:left-1/2 after:z-10 after:h-1 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-chart-4 after:content-['']",
        }}
        className="mx-auto rounded-lg border max-md:[--cell-size:--spacing(10)] md:mx-0"
      />
      <div className="min-w-0">
        <p className="mb-2 font-serif text-base">{selectedLabel}</p>
        {dayEvents.length === 0 ? (
          <RobotEmptyState caption="A free day." className="py-4" />
        ) : (
          <div className="stagger-children grid gap-1">
            {dayEvents.map((event) => (
              <EventCard
                key={`${event.id}-${event.time}`}
                householdId={householdId}
                tz={tz}
                event={event}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { AsciiEmptyState } from "@/components/ascii/ascii-empty-state";
import { deleteEvent } from "@/app/h/[id]/actions";
import type { CalendarEvent } from "./types";

function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function keyToDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Month grid with event dots; selecting a day shows its events beside it. */
export function CalendarView({
  householdId,
  events,
  todayKey,
}: {
  householdId: string;
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
        className="mx-auto rounded-lg border md:mx-0"
      />
      <div className="min-w-0">
        <p className="mb-2 font-serif text-base">{selectedLabel}</p>
        {dayEvents.length === 0 ? (
          <AsciiEmptyState variant="sun" caption="A free day." className="py-4" />
        ) : (
          <div className="stagger-children grid gap-1">
            {dayEvents.map((e) => (
              <div
                key={e.id}
                className="group hover:bg-muted/50 flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors"
              >
                <span className="bg-chart-4 h-2 w-2 shrink-0 rounded-full" aria-hidden />
                <span className="text-muted-foreground w-20 shrink-0 text-xs">{e.time}</span>
                <span className="flex-1 truncate text-sm">{e.title}</span>
                {e.location && <span className="text-muted-foreground truncate text-xs">{e.location}</span>}
                <form action={deleteEvent.bind(null, householdId, e.id)}>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="submit"
                    className="text-muted-foreground h-6 w-6 p-0 opacity-0 transition-opacity group-hover:opacity-100"
                    title="Delete"
                  >
                    &times;
                  </Button>
                </form>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

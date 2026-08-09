import Link from "next/link";
import { getHousehold } from "@/lib/household";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, fmtTime, localDate } from "@/lib/format";
import { updateEvent } from "../actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function ymdAdd(s: string, days: number): string {
  const d = parseYmd(s);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ d?: string; m?: string; view?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const household = await getHousehold(slug);
  const tz = household.timezone ?? "UTC";
  const supabase = await createClient();

  const todayStr = localDate(new Date(), tz);
  const selected = /^\d{4}-\d{2}-\d{2}$/.test(sp.d ?? "") ? sp.d! : null;
  const view = sp.view === "week" ? "week" : "month";
  const monthStr = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? sp.m! : (selected ?? todayStr).slice(0, 7);

  // Visible range: the padded month grid, or the selected week.
  const [year, month] = monthStr.split("-").map(Number);
  const firstOfMonth = `${monthStr}-01`;
  const firstWeekday = parseYmd(firstOfMonth).getUTCDay();
  const gridStart =
    view === "month"
      ? ymdAdd(firstOfMonth, -firstWeekday)
      : ymdAdd(selected ?? todayStr, -parseYmd(selected ?? todayStr).getUTCDay());
  const gridDays = view === "month" ? 42 : 7;
  const gridEnd = ymdAdd(gridStart, gridDays);

  const { data: events } = await supabase
    .from("events")
    .select("id, short_code, title, starts_at, ends_at, all_day, location, status")
    .eq("household_id", household.id)
    .gte("starts_at", parseYmd(gridStart).toISOString())
    .lt("starts_at", parseYmd(gridEnd).toISOString())
    .order("starts_at");

  const byDay = new Map<string, NonNullable<typeof events>>();
  for (const e of events ?? []) {
    const key = localDate(new Date(e.starts_at), tz);
    byDay.set(key, [...(byDay.get(key) ?? []), e]);
  }

  const days = Array.from({ length: gridDays }, (_, i) => ymdAdd(gridStart, i));
  const dayEvents = selected ? (byDay.get(selected) ?? []) : [];

  const prevMonth = `${month === 1 ? year - 1 : year}-${String(month === 1 ? 12 : month - 1).padStart(2, "0")}`;
  const nextMonth = `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, "0")}`;
  const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
    parseYmd(firstOfMonth),
  );

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{monthLabel}</h1>
        <div className="ml-auto flex items-center gap-1">
          <Button asChild size="sm" variant={view === "month" ? "default" : "outline"}>
            <Link href={`/h/${slug}/calendar?m=${monthStr}`}>Month</Link>
          </Button>
          <Button asChild size="sm" variant={view === "week" ? "default" : "outline"}>
            <Link href={`/h/${slug}/calendar?view=week&d=${selected ?? todayStr}`}>Week</Link>
          </Button>
          {view === "month" && (
            <>
              <Button asChild size="sm" variant="outline">
                <Link href={`/h/${slug}/calendar?m=${prevMonth}`}>←</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href={`/h/${slug}/calendar?m=${nextMonth}`}>→</Link>
              </Button>
            </>
          )}
          {view === "week" && (
            <>
              <Button asChild size="sm" variant="outline">
                <Link href={`/h/${slug}/calendar?view=week&d=${ymdAdd(selected ?? todayStr, -7)}`}>←</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href={`/h/${slug}/calendar?view=week&d=${ymdAdd(selected ?? todayStr, 7)}`}>→</Link>
              </Button>
            </>
          )}
        </div>
      </div>

      <div className={cn("grid gap-px overflow-hidden rounded-lg border bg-border", "grid-cols-7")}>
        {WEEKDAYS.map((d) => (
          <div key={d} className="bg-muted px-2 py-1 text-center text-xs font-medium text-muted-foreground">
            {d}
          </div>
        ))}
        {days.map((day) => {
          const inMonth = day.slice(0, 7) === monthStr;
          const evts = byDay.get(day) ?? [];
          return (
            <Link
              key={day}
              href={`/h/${slug}/calendar?${view === "week" ? "view=week&" : `m=${monthStr}&`}d=${day}`}
              className={cn(
                "min-h-20 bg-background p-1.5 text-xs hover:bg-accent",
                view === "month" && !inMonth && "text-muted-foreground/50",
                selected === day && "ring-2 ring-ring ring-inset",
              )}
            >
              <span
                className={cn(
                  "inline-flex size-5 items-center justify-center rounded-full",
                  day === todayStr && "bg-primary text-primary-foreground",
                )}
              >
                {Number(day.slice(8))}
              </span>
              <div className="mt-1 grid gap-0.5">
                {evts.slice(0, 3).map((e) => (
                  <div
                    key={e.id}
                    className={cn(
                      "truncate rounded bg-secondary px-1 py-0.5",
                      e.status === "cancelled" && "line-through opacity-60",
                    )}
                  >
                    {e.title}
                  </div>
                ))}
                {evts.length > 3 && <div className="text-muted-foreground">+{evts.length - 3} more</div>}
              </div>
            </Link>
          );
        })}
      </div>

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle>{fmtDate(parseYmd(selected).toISOString(), "UTC")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {dayEvents.length === 0 && (
              <p className="text-sm text-muted-foreground">No events this day.</p>
            )}
            {dayEvents.map((e) => (
              <details key={e.id} className="rounded-md border">
                <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
                  <span className={cn("font-medium", e.status === "cancelled" && "line-through")}>
                    {e.title}
                  </span>
                  <span className="text-muted-foreground">
                    {e.all_day ? "All day" : fmtTime(e.starts_at, tz)}
                    {e.ends_at && !e.all_day ? `–${fmtTime(e.ends_at, tz)}` : ""}
                  </span>
                  {e.location && <Badge variant="outline">{e.location}</Badge>}
                  {e.status === "cancelled" && <Badge variant="secondary">Cancelled</Badge>}
                </summary>
                <form action={updateEvent} className="grid gap-3 border-t p-3">
                  <input type="hidden" name="event_id" value={e.id} />
                  <input type="hidden" name="slug" value={slug} />
                  <div className="grid gap-2">
                    <Label>Title</Label>
                    <Input name="title" defaultValue={e.title} required />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="grid gap-2">
                      <Label>Starts</Label>
                      <Input name="starts_at" type="datetime-local" defaultValue={toLocalInput(e.starts_at, tz)} />
                    </div>
                    <div className="grid gap-2">
                      <Label>Ends</Label>
                      <Input name="ends_at" type="datetime-local" defaultValue={toLocalInput(e.ends_at, tz)} />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label>Location</Label>
                    <Input name="location" defaultValue={e.location ?? ""} />
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" name="status" value={e.status} variant="outline" size="sm">
                      Save
                    </Button>
                    <Button
                      type="submit"
                      name="status"
                      value={e.status === "cancelled" ? "active" : "cancelled"}
                      variant={e.status === "cancelled" ? "secondary" : "destructive"}
                      size="sm"
                    >
                      {e.status === "cancelled" ? "Restore" : "Cancel event"}
                    </Button>
                  </div>
                </form>
              </details>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

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

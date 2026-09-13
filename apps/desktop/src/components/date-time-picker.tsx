import { useEffect, useRef, useState } from "react";
import { CalendarIcon, Clock3Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function dateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function defaultTime(): string {
  const nextHour = new Date(Date.now() + 60 * 60 * 1000);
  nextHour.setMinutes(0, 0, 0);
  return `${String(nextHour.getHours()).padStart(2, "0")}:00`;
}

function parseDefault(value?: string): { date?: Date; time: string } {
  if (!value) return { time: defaultTime() };
  const [day, time = defaultTime()] = value.split("T");
  const [year, month, date] = day!.split("-").map(Number);
  if (!year || !month || !date) return { time: defaultTime() };
  return { date: new Date(year, month - 1, date), time: time.slice(0, 5) };
}

export function DateTimePicker({
  name,
  timeZone,
  defaultValue,
  placeholder = "Choose date and time",
  className,
  required,
}: {
  name: string;
  timeZone: string;
  defaultValue?: string;
  placeholder?: string;
  className?: string;
  required?: boolean;
}) {
  const initial = parseDefault(defaultValue);
  const [date, setDate] = useState<Date | undefined>(initial.date);
  const [time, setTime] = useState(initial.time);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const value = date ? `${dateValue(date)}T${time}` : "";

  useEffect(() => {
    const form = triggerRef.current?.closest("form");
    if (!form) return;
    const reset = () => {
      const next = parseDefault(defaultValue);
      setDate(next.date);
      setTime(next.time);
      setOpen(false);
    };
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [defaultValue]);

  const chooseOffset = (days: number) => {
    const next = new Date();
    next.setHours(12, 0, 0, 0);
    next.setDate(next.getDate() + days);
    setDate(next);
  };

  const label = date
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(date) +
      ` at ${new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(new Date(2000, 0, 1, Number(time.slice(0, 2)), Number(time.slice(3, 5))))}`
    : placeholder;

  return (
    <>
      <input type="hidden" name={name} value={value} required={required} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={triggerRef}
            type="button"
            variant="outline"
            className={cn(
              "w-full justify-start text-left font-normal sm:w-64",
              !date && "text-muted-foreground",
              className,
            )}
          >
            <CalendarIcon />
            <span className="truncate">{label}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <div className="border-border flex gap-1 border-b p-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => chooseOffset(0)}>
              Today
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => chooseOffset(1)}>
              Tomorrow
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => chooseOffset(7)}>
              Next week
            </Button>
          </div>
          <Calendar mode="single" selected={date} onSelect={setDate} />
          <div className="border-border grid gap-2 border-t p-3">
            <label className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
              <Clock3Icon className="size-4" />
              Time
            </label>
            <Input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground max-w-48 truncate text-xs" title={timeZone}>
                {timeZone}
              </span>
              <Button type="button" size="sm" disabled={!date || !time} onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}

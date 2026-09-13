import { useEffect, useRef, useState } from "react";
import { RepeatIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  buildRRule,
  describeRRule,
  WEEKDAYS,
  type Frequency,
  type RecurrenceEnd,
} from "@/lib/recurrence";

const selectClass =
  "border-input h-8 w-full rounded-md border bg-transparent px-2 text-sm shadow-xs outline-none";

/**
 * Builds a validated RFC-5545 RRULE without exposing raw syntax. Emits a
 * hidden input so it drops into the existing FormData create flows.
 * "Forever" (no COUNT/UNTIL) is the default end condition.
 */
export function RecurrencePicker({ name, className }: { name: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [freq, setFreq] = useState<Frequency | "none">("none");
  const [interval, setInterval] = useState(1);
  const [byDays, setByDays] = useState<string[]>([]);
  const [endType, setEndType] = useState<RecurrenceEnd["type"]>("forever");
  const [count, setCount] = useState(10);
  const [untilDate, setUntilDate] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const form = triggerRef.current?.closest("form");
    if (!form) return;
    const reset = () => {
      setFreq("none");
      setInterval(1);
      setByDays([]);
      setEndType("forever");
      setCount(10);
      setUntilDate("");
      setOpen(false);
    };
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, []);

  const end: RecurrenceEnd =
    endType === "count"
      ? { type: "count", count }
      : endType === "until" && untilDate
        ? { type: "until", date: untilDate }
        : { type: "forever" };

  const value =
    freq === "none" ? "" : buildRRule({ freq, interval: Math.max(1, interval), byDays, end });
  const label = value ? `Repeats ${describeRRule(value)}` : "Does not repeat";

  const endChip = (type: RecurrenceEnd["type"], text: string) => (
    <button
      type="button"
      onClick={() => setEndType(type)}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
        endType === type
          ? "bg-primary text-primary-foreground border-primary"
          : "text-muted-foreground hover:bg-muted border-input",
      )}
    >
      {text}
    </button>
  );

  return (
    <>
      <input type="hidden" name={name} value={value} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={triggerRef}
            type="button"
            variant="outline"
            className={cn(
              "w-full justify-start text-left font-normal sm:w-52",
              !value && "text-muted-foreground",
              className,
            )}
          >
            <RepeatIcon />
            <span className="truncate">{label}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-3" align="start">
          <div className="grid gap-3">
            <div className="grid gap-1">
              <label className="text-muted-foreground text-xs font-medium">Repeats</label>
              <select
                className={selectClass}
                value={freq}
                onChange={(e) => setFreq(e.target.value as Frequency | "none")}
              >
                <option value="none">Does not repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>

            {freq !== "none" && (
              <>
                <div className="grid gap-1">
                  <label className="text-muted-foreground text-xs font-medium">
                    Every
                  </label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={99}
                      value={interval}
                      onChange={(e) => setInterval(Number(e.target.value) || 1)}
                      className="h-8 w-16"
                    />
                    <span className="text-muted-foreground text-xs">
                      {freq === "daily" ? "day(s)" : freq === "weekly" ? "week(s)" : "month(s)"}
                    </span>
                  </div>
                </div>

                {freq === "weekly" && (
                  <div className="grid gap-1">
                    <label className="text-muted-foreground text-xs font-medium">On</label>
                    <div className="flex gap-1">
                      {WEEKDAYS.map((d) => (
                        <button
                          key={d.code}
                          type="button"
                          onClick={() =>
                            setByDays((prev) =>
                              prev.includes(d.code)
                                ? prev.filter((c) => c !== d.code)
                                : [...prev, d.code],
                            )
                          }
                          className={cn(
                            "h-7 w-8 rounded-md border text-xs transition-colors",
                            byDays.includes(d.code)
                              ? "bg-primary text-primary-foreground border-primary"
                              : "text-muted-foreground hover:bg-muted border-input",
                          )}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-muted-foreground text-[10px]">
                      Leave empty to repeat on the due date's weekday.
                    </p>
                  </div>
                )}

                <div className="grid gap-1.5">
                  <label className="text-muted-foreground text-xs font-medium">Ends</label>
                  <div className="flex items-center gap-1.5">
                    {endChip("forever", "Never")}
                    {endChip("count", "After")}
                    {endChip("until", "On date")}
                  </div>
                  {endType === "count" && (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={1}
                        max={999}
                        value={count}
                        onChange={(e) => setCount(Number(e.target.value) || 1)}
                        className="h-8 w-20"
                      />
                      <span className="text-muted-foreground text-xs">time(s)</span>
                    </div>
                  )}
                  {endType === "until" && (
                    <Input
                      type="date"
                      value={untilDate}
                      onChange={(e) => setUntilDate(e.target.value)}
                      className="h-8"
                    />
                  )}
                </div>
              </>
            )}

            <div className="flex justify-end">
              <Button type="button" size="sm" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}

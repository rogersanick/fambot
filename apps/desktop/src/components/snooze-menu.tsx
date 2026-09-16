import { useState } from "react";
import { Clock3Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { localToIso } from "@/lib/api";
import { localDate } from "@/lib/format";

/**
 * Quick postpone menu for a task occurrence. Only the effective due time
 * moves — for recurring tasks the rest of the series keeps its fixed schedule.
 */
export function SnoozeMenu({
  tz,
  isRecurring,
  onPostpone,
  onStopRepeating,
}: {
  tz: string;
  isRecurring: boolean;
  /** Receives an ISO instant for the new due time. */
  onPostpone: (iso: string) => void;
  onStopRepeating?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");

  const pick = (iso: string | null) => {
    if (!iso) return;
    onPostpone(iso);
    setOpen(false);
    setCustom("");
  };

  const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
  const atLocal = (daysFromNow: number, time: string) =>
    localToIso(`${localDate(new Date(Date.now() + daysFromNow * 86_400_000), tz)}T${time}`, tz);

  const quick = (label: string, iso: string | null) => (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-7 justify-start text-xs"
      onClick={() => pick(iso)}
    >
      {label}
    </Button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          className="text-muted-foreground h-8 w-8 p-0 opacity-100 transition-opacity md:h-6 md:w-6 md:opacity-0 md:group-hover:opacity-100"
          title={isRecurring ? "Postpone this occurrence" : "Postpone"}
        >
          <Clock3Icon className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="end">
        <p className="text-muted-foreground mb-1 px-1 text-[10px] font-medium tracking-wide uppercase">
          {isRecurring ? "Postpone this occurrence" : "Postpone"}
        </p>
        <div className="grid">
          {quick("In 1 hour", inHours(1))}
          {quick("This evening (6pm)", atLocal(0, "18:00"))}
          {quick("Tomorrow morning (9am)", atLocal(1, "09:00"))}
          {quick("Next week", atLocal(7, "09:00"))}
        </div>
        <div className="border-border mt-2 grid gap-1.5 border-t pt-2">
          <Input
            type="datetime-local"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            className="h-8 text-xs"
          />
          <Button
            type="button"
            size="sm"
            disabled={!custom}
            onClick={() => pick(localToIso(custom, tz))}
          >
            Set
          </Button>
        </div>
        {isRecurring && onStopRepeating && (
          <div className="border-border mt-2 border-t pt-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive h-7 w-full justify-start text-xs"
              onClick={() => {
                onStopRepeating();
                setOpen(false);
              }}
            >
              Stop repeating (cancel series)
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SubmitButton } from "@/components/submit-button";
import { AsciiEmptyState } from "@/components/ascii/ascii-empty-state";
import { api, localToIso } from "@/lib/api";
import { useAction } from "./use-actions";
import { fmtWhen } from "@/lib/format";
import type { ReminderRow } from "./types";
import { cn } from "@/lib/utils";

export function RemindersTab({
  householdId,
  tz,
  reminders,
}: {
  householdId: string;
  tz: string;
  reminders: ReminderRow[];
}) {
  const create = useAction(householdId);
  const cancel = useAction(householdId);
  const pending = reminders.filter((r) => r.status === "pending");
  const past = reminders.filter((r) => r.status !== "pending").slice(0, 5);

  return (
    <div className="grid gap-4">
      <Card className="animate-fade-up">
        <CardHeader>
          <CardTitle className="font-serif text-lg">Schedule a reminder</CardTitle>
          <CardDescription>
            Delivered in-app, or over iMessage when the bridge is connected. You can also just tell
            Fambot in the Chat tab.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const fd = new FormData(form);
              const title = String(fd.get("message") ?? "").trim();
              const fireAt = localToIso(String(fd.get("fire_at") ?? ""), tz);
              if (!title || !fireAt) return;
              void create.run(() => api.reminders.create(householdId, { title, fireAt })).then((ok) => ok && form.reset());
            }}
            className="grid gap-3 sm:grid-cols-[1fr_auto_auto]"
          >
            <Input name="message" placeholder="Take out the trash tonight!" required />
            <Input name="fire_at" type="datetime-local" required className="sm:w-52" />
            <SubmitButton pending={create.pending}>Schedule</SubmitButton>
          </form>
        </CardContent>
      </Card>

      <Card className="animate-fade-up" style={{ animationDelay: "80ms" }}>
        <CardHeader>
          <CardTitle className="font-serif text-lg">Pending ({pending.length})</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {pending.length === 0 && <AsciiEmptyState variant="bell" caption="No reminders pending. Silence is golden." />}
          {pending.length > 0 && (
            <div className="stagger-children border-border ml-2 grid border-l-2">
              {pending.map((r, i) => (
                <div key={r.id} className="group relative py-2 pl-5">
                  <span
                    className={cn(
                      "bg-chart-2 ring-background absolute top-3.5 -left-[5px] h-2 w-2 rounded-full ring-2",
                      i === 0 && "animate-gentle-pulse",
                    )}
                    aria-hidden
                  />
                  <div className="hover:bg-muted/50 -my-1 flex items-center gap-3 rounded-md px-2 py-1 transition-colors">
                    <span className="flex-1 text-sm">{r.message}</span>
                    {r.recurring && (
                      <Badge variant="outline" className="text-[10px]">
                        recurring
                      </Badge>
                    )}
                    <span className="text-muted-foreground text-xs">{fmtWhen(r.fire_at, tz)}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={() => cancel.run(() => api.reminders.cancel(householdId, r.id))}
                      className="text-muted-foreground h-6 w-6 p-0 opacity-0 transition-opacity group-hover:opacity-100"
                      title="Cancel"
                    >
                      &times;
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {past.length > 0 && (
            <>
              <Separator />
              <div className="grid gap-0.5">
                {past.map((r) => (
                  <div key={r.id} className="text-muted-foreground flex items-center gap-3 px-2 py-1">
                    <span className="flex-1 text-sm">{r.message}</span>
                    <Badge
                      variant="outline"
                      className={cn(r.status === "sent" && "border-chart-1/40 text-chart-1")}
                    >
                      {r.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

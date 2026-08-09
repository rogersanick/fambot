import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtWhen, fmtDate, fmtTime, isOverdue, localDate } from "@/lib/format";
import {
  addChannel,
  addMember,
  cancelReminder,
  createEvent,
  createReminder,
  createTask,
  deleteEvent,
  setTaskStatus,
  signOut,
  updateHousehold,
} from "./actions";

const selectClass =
  "border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none";

export default async function HouseholdPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/h/${id}`)}`);

  const { data: household } = await supabase
    .from("households")
    .select("id, name, timezone")
    .eq("id", id)
    .maybeSingle();
  if (!household) notFound();
  const tz = household.timezone;

  const [{ data: members }, { data: channels }, { data: tasks }, { data: events }, { data: reminders }] =
    await Promise.all([
      supabase.from("members").select("id, display_name, role, handle").eq("household_id", id).order("created_at"),
      supabase.from("channels").select("id, chat_guid, name").eq("household_id", id).order("created_at"),
      supabase
        .from("tasks")
        .select("id, title, status, due_at, completed_at, assignee:members!tasks_assignee_id_fkey(display_name)")
        .eq("household_id", id)
        .order("due_at", { ascending: true, nullsFirst: false })
        .order("created_at"),
      supabase
        .from("events")
        .select("id, title, starts_at, ends_at, location")
        .eq("household_id", id)
        // Server component: per-request "now" is intentional here.
        // eslint-disable-next-line react-hooks/purity
        .gte("starts_at", new Date(Date.now() - 86400000).toISOString())
        .order("starts_at"),
      supabase
        .from("reminders")
        .select("id, message, fire_at, status, sent_at")
        .eq("household_id", id)
        .order("fire_at", { ascending: false })
        .limit(50),
    ]);

  const openTasks = (tasks ?? []).filter((t) => t.status === "open");
  const doneTasks = (tasks ?? []).filter((t) => t.status === "done").slice(-5).reverse();
  const pendingReminders = (reminders ?? []).filter((r) => r.status === "pending").reverse();
  const pastReminders = (reminders ?? []).filter((r) => r.status !== "pending").slice(0, 5);

  const eventsByDay = new Map<string, NonNullable<typeof events>>();
  for (const e of events ?? []) {
    const day = localDate(new Date(e.starts_at), tz);
    if (!eventsByDay.has(day)) eventsByDay.set(day, []);
    eventsByDay.get(day)!.push(e);
  }

  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{household.name}</h1>
          <p className="text-sm text-muted-foreground">{tz}</p>
        </div>
        <form action={signOut}>
          <Button variant="ghost" size="sm" type="submit">
            Sign out
          </Button>
        </form>
      </header>

      <Tabs defaultValue="todos">
        <TabsList className="mb-4">
          <TabsTrigger value="todos">Todos</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="reminders">Reminders</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="todos" className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Add a todo</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={createTask.bind(null, id, tz)} className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
                <Input name="title" placeholder="Pick up the dry cleaning" required />
                <select name="assignee_id" className={selectClass + " sm:w-40"} defaultValue="">
                  <option value="">Anyone</option>
                  {(members ?? [])
                    .filter((m) => m.role !== "agent")
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.display_name}
                      </option>
                    ))}
                </select>
                <Input name="due_at" type="datetime-local" className="sm:w-52" />
                <Button type="submit">Add</Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Open ({openTasks.length})</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-1">
              {openTasks.length === 0 && <p className="text-sm text-muted-foreground">Nothing to do. Nice.</p>}
              {openTasks.map((t) => (
                <div key={t.id} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50">
                  <form action={setTaskStatus.bind(null, id, t.id, "done")}>
                    <Button variant="outline" size="sm" type="submit" className="h-6 w-6 rounded-full p-0" title="Mark done">
                      &#10003;
                    </Button>
                  </form>
                  <span className="flex-1 text-sm">{t.title}</span>
                  {t.assignee && <Badge variant="secondary">{t.assignee.display_name}</Badge>}
                  {t.due_at && (
                    <span className={`text-xs ${isOverdue(t.due_at) ? "text-destructive" : "text-muted-foreground"}`}>
                      {fmtWhen(t.due_at, tz)}
                    </span>
                  )}
                  <form action={setTaskStatus.bind(null, id, t.id, "cancelled")}>
                    <Button variant="ghost" size="sm" type="submit" className="h-6 w-6 p-0 text-muted-foreground" title="Cancel">
                      &times;
                    </Button>
                  </form>
                </div>
              ))}
              {doneTasks.length > 0 && (
                <>
                  <Separator className="my-2" />
                  {doneTasks.map((t) => (
                    <div key={t.id} className="flex items-center gap-3 px-2 py-1 text-muted-foreground">
                      <span className="flex-1 text-sm line-through">{t.title}</span>
                      <form action={setTaskStatus.bind(null, id, t.id, "open")}>
                        <Button variant="ghost" size="sm" type="submit" className="h-6 text-xs">
                          Reopen
                        </Button>
                      </form>
                    </div>
                  ))}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calendar" className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Add an event</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={createEvent.bind(null, id, tz)} className="grid gap-3 sm:grid-cols-2">
                <Input name="title" placeholder="Soccer practice" required className="sm:col-span-2" />
                <div className="grid gap-1">
                  <Label className="text-xs text-muted-foreground">Starts</Label>
                  <Input name="starts_at" type="datetime-local" required />
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs text-muted-foreground">Ends (optional)</Label>
                  <Input name="ends_at" type="datetime-local" />
                </div>
                <Input name="location" placeholder="Location (optional)" />
                <Button type="submit">Add event</Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Upcoming</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              {eventsByDay.size === 0 && <p className="text-sm text-muted-foreground">No upcoming events.</p>}
              {[...eventsByDay.entries()].map(([day, dayEvents]) => (
                <div key={day}>
                  <p className="mb-1 text-sm font-medium">{fmtDate(dayEvents[0].starts_at, tz)}</p>
                  <div className="grid gap-1">
                    {dayEvents.map((e) => (
                      <div key={e.id} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50">
                        <span className="w-20 text-xs text-muted-foreground">{fmtTime(e.starts_at, tz)}</span>
                        <span className="flex-1 text-sm">{e.title}</span>
                        {e.location && <span className="text-xs text-muted-foreground">{e.location}</span>}
                        <form action={deleteEvent.bind(null, id, e.id)}>
                          <Button variant="ghost" size="sm" type="submit" className="h-6 w-6 p-0 text-muted-foreground" title="Delete">
                            &times;
                          </Button>
                        </form>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reminders" className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Schedule a reminder</CardTitle>
              <CardDescription>
                Delivered over iMessage to your group chat by the bridge when it fires.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action={createReminder.bind(null, id, tz)} className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
                <Input name="message" placeholder="Take out the trash tonight!" required />
                <Input name="fire_at" type="datetime-local" required className="sm:w-52" />
                <Button type="submit">Schedule</Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pending ({pendingReminders.length})</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-1">
              {pendingReminders.length === 0 && <p className="text-sm text-muted-foreground">No pending reminders.</p>}
              {pendingReminders.map((r) => (
                <div key={r.id} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50">
                  <span className="flex-1 text-sm">{r.message}</span>
                  <span className="text-xs text-muted-foreground">{fmtWhen(r.fire_at, tz)}</span>
                  <form action={cancelReminder.bind(null, id, r.id)}>
                    <Button variant="ghost" size="sm" type="submit" className="h-6 w-6 p-0 text-muted-foreground" title="Cancel">
                      &times;
                    </Button>
                  </form>
                </div>
              ))}
              {pastReminders.length > 0 && (
                <>
                  <Separator className="my-2" />
                  {pastReminders.map((r) => (
                    <div key={r.id} className="flex items-center gap-3 px-2 py-1 text-muted-foreground">
                      <span className="flex-1 text-sm">{r.message}</span>
                      <Badge variant="outline">{r.status}</Badge>
                    </div>
                  ))}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Household</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={updateHousehold.bind(null, id)} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <Input name="name" defaultValue={household.name} required />
                <Input name="timezone" defaultValue={tz} required />
                <Button type="submit" variant="outline">
                  Save
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Members</CardTitle>
              <CardDescription>
                The handle is how FamBot recognizes who&apos;s texting: a phone in E.164 form
                (+15551234567) or an email.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid gap-1">
                {(members ?? []).map((m) => (
                  <div key={m.id} className="flex items-center gap-3 px-2 py-1">
                    <span className="flex-1 text-sm">{m.display_name}</span>
                    {m.handle && <span className="font-mono text-xs text-muted-foreground">{m.handle}</span>}
                    <Badge variant={m.role === "agent" ? "default" : "secondary"}>{m.role}</Badge>
                  </div>
                ))}
              </div>
              <Separator />
              <form action={addMember.bind(null, id)} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                <Input name="display_name" placeholder="Name" required />
                <Input name="handle" placeholder="+15551234567" />
                <Input name="email" placeholder="Account email (optional)" type="email" />
                <Button type="submit" variant="outline">
                  Add member
                </Button>
              </form>
              <p className="text-xs text-muted-foreground">
                Provide an account email to link a login — use your agent&apos;s email (e.g.{" "}
                <span className="font-mono">agent@fambot.local</span>) to give FamBot access to
                this household.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>iMessage channels</CardTitle>
              <CardDescription>
                Chats mapped to this household. Find a chat&apos;s GUID with{" "}
                <span className="font-mono text-xs">imsg chats --limit 20</span>.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid gap-1">
                {(channels ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No chats mapped yet — reminders stay portal-only until one is.
                  </p>
                )}
                {(channels ?? []).map((c) => (
                  <div key={c.id} className="flex items-center gap-3 px-2 py-1">
                    <span className="flex-1 text-sm">{c.name ?? "Unnamed chat"}</span>
                    <span className="font-mono text-xs text-muted-foreground">{c.chat_guid}</span>
                  </div>
                ))}
              </div>
              <Separator />
              <form action={addChannel.bind(null, id)} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <Input name="chat_guid" placeholder="iMessage;+;chat123..." required />
                <Input name="name" placeholder="Family group chat" />
                <Button type="submit" variant="outline">
                  Map chat
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </main>
  );
}

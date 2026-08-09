import Link from "next/link";
import { getHousehold } from "@/lib/household";
import { createClient } from "@/lib/supabase/server";
import { fmtWhen, isOverdue } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

const STATUS_FILTERS = ["open", "done", "cancelled", "all"] as const;

export default async function TasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ status?: string; assignee?: string }>;
}) {
  const { slug } = await params;
  const filters = await searchParams;
  const status = STATUS_FILTERS.includes(filters.status as never) ? filters.status! : "open";

  const household = await getHousehold(slug);
  const tz = household.timezone ?? "UTC";
  const supabase = await createClient();

  let query = supabase
    .from("tasks")
    .select("id, short_code, title, status, due_at, assignee_member_id, created_at")
    .eq("household_id", household.id)
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (status !== "all") query = query.eq("status", status);
  if (filters.assignee) query = query.eq("assignee_member_id", filters.assignee);

  const [{ data: tasks }, { data: members }] = await Promise.all([
    query,
    supabase.from("members").select("id, display_name, normalized_handle").is("removed_at", null),
  ]);

  const memberName = (id: string | null) => {
    const m = members?.find((x) => x.id === id);
    return m ? (m.display_name?.split(/\s+/)[0] ?? m.normalized_handle) : "—";
  };

  const filterHref = (s: string, assignee?: string) =>
    `/h/${slug}/tasks?status=${s}${assignee ? `&assignee=${assignee}` : ""}`;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-4 text-xl font-semibold tracking-tight">Tasks</h1>
        {STATUS_FILTERS.map((s) => (
          <Button key={s} asChild size="sm" variant={s === status ? "default" : "outline"}>
            <Link href={filterHref(s, filters.assignee)} className="capitalize">
              {s}
            </Link>
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Assignee:</span>
        <Button asChild size="sm" variant={!filters.assignee ? "secondary" : "ghost"}>
          <Link href={filterHref(status)}>Anyone</Link>
        </Button>
        {(members ?? []).map((m) => (
          <Button key={m.id} asChild size="sm" variant={filters.assignee === m.id ? "secondary" : "ghost"}>
            <Link href={filterHref(status, m.id)}>
              {m.display_name?.split(/\s+/)[0] ?? m.normalized_handle}
            </Link>
          </Button>
        ))}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Task</TableHead>
            <TableHead>Assignee</TableHead>
            <TableHead>Due</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(tasks ?? []).length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                No tasks match this filter.
              </TableCell>
            </TableRow>
          )}
          {(tasks ?? []).map((t) => (
            <TableRow key={t.id}>
              <TableCell>
                <Link href={`/h/${slug}/k/${t.short_code}`} className="font-medium hover:underline">
                  {t.title}
                </Link>
              </TableCell>
              <TableCell>{memberName(t.assignee_member_id)}</TableCell>
              <TableCell>
                {t.due_at ? (
                  <span className={isOverdue(t.due_at) && t.status === "open" ? "text-destructive" : ""}>
                    {fmtWhen(t.due_at, tz)}
                  </span>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell>
                <Badge
                  variant={t.status === "open" ? "default" : t.status === "done" ? "secondary" : "outline"}
                  className="capitalize"
                >
                  {t.status}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

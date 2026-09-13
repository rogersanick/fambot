import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/submit-button";
import { RobotEmptyState } from "@/components/robot/scenes";
import {
  ListChecks,
  ListPlus,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAction } from "./use-actions";
import { CommentThreadDialog } from "./comment-thread-dialog";
import type { ListRow, TaskRow } from "./types";

function ListCard({
  householdId,
  tz,
  list,
  tasks,
}: {
  householdId: string;
  tz: string;
  list: ListRow;
  tasks: TaskRow[];
}) {
  const [renaming, setRenaming] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const action = useAction(householdId);
  const listTasks = tasks.filter(
    (task) => task.list_id === list.id && task.status !== "cancelled"
  );
  const openCount = listTasks.filter((task) => task.status === "open").length;
  const orderedTasks = [...listTasks].sort((a, b) => {
    if (a.status === b.status) return a.title.localeCompare(b.title);
    return a.status === "done" ? 1 : -1;
  });

  return (
    <Card className="min-w-0 gap-0 overflow-hidden py-0">
      <CardHeader className="border-b bg-muted/30 py-4">
        {renaming ? (
          <form
            className="col-span-full grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
              if (!name) return;
              void action.run(() => api.lists.rename(householdId, list.id, name)).then((ok) => {
                if (ok) setRenaming(false);
              });
            }}
          >
            <Input className="min-w-0" name="name" defaultValue={list.name} autoFocus required />
            <SubmitButton size="sm" pending={action.pending}>
              Save
            </SubmitButton>
            <Button
              className="col-span-full h-auto justify-self-start p-0 text-xs"
              type="button"
              variant="link"
              onClick={() => setRenaming(false)}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <>
            <div className="min-w-0">
              <CardTitle className="truncate font-serif text-lg">{list.name}</CardTitle>
              <CardDescription className="mt-1 flex items-center gap-2">
                <span>
                  {listTasks.length} {listTasks.length === 1 ? "item" : "items"}
                </span>
                <span aria-hidden>·</span>
                <span>{openCount} remaining</span>
              </CardDescription>
            </div>
            <CardAction className="flex items-center gap-1">
              <CommentThreadDialog
                householdId={householdId}
                tz={tz}
                subject="list"
                subjectId={list.id}
                title={list.name}
                trigger={
                  <Button type="button" variant="ghost" size="icon-sm" title="Comments">
                    <MessageSquare />
                    <span className="sr-only">Comments for {list.name}</span>
                  </Button>
                }
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon-sm">
                    <MoreHorizontal />
                    <span className="sr-only">Actions for {list.name}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setRenaming(true)}>
                    <Pencil />
                    Rename list
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => action.run(() => api.lists.remove(householdId, list.id))}
                  >
                    <Trash2 />
                    Delete list
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardAction>
          </>
        )}
      </CardHeader>

      <CardContent className="min-w-0 p-0">
        {orderedTasks.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <div className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full">
              <ListChecks className="size-5" />
            </div>
            <div>
              <p className="text-sm font-medium">This list is empty</p>
              <p className="text-muted-foreground text-xs">Add the first item below.</p>
            </div>
          </div>
        ) : (
          <div className="max-h-80 divide-y overflow-y-auto overscroll-contain">
            {orderedTasks.map((task) => (
              <div key={task.id} className="group flex min-w-0 items-center gap-3 px-4 py-3">
                <Checkbox
                  checked={task.status === "done"}
                  aria-label={
                    task.status === "done"
                      ? `Mark ${task.title} not done`
                      : `Mark ${task.title} done`
                  }
                  disabled={action.pending}
                  onCheckedChange={() =>
                    action.run(() =>
                      api.tasks.patch(householdId, task.id, {
                        status: task.status === "done" ? "open" : "done",
                      })
                    )
                  }
                />

                {editingItemId === task.id ? (
                  <form
                    className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const title = String(
                        new FormData(event.currentTarget).get("title") ?? ""
                      ).trim();
                      if (!title) return;
                      void action
                        .run(() => api.tasks.patch(householdId, task.id, { title }))
                        .then((ok) => {
                          if (ok) setEditingItemId(null);
                        });
                    }}
                  >
                    <Input
                      className="h-8 min-w-0"
                      name="title"
                      defaultValue={task.title}
                      autoFocus
                      required
                    />
                    <SubmitButton size="sm" pending={action.pending}>
                      Save
                    </SubmitButton>
                    <Button
                      className="col-span-full h-auto justify-self-start p-0 text-xs"
                      type="button"
                      variant="link"
                      onClick={() => setEditingItemId(null)}
                    >
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <>
                    <span
                      className={cn(
                        "min-w-0 flex-1 break-words text-sm",
                        task.status === "done" && "text-muted-foreground line-through"
                      )}
                    >
                      {task.title}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground shrink-0 opacity-70 transition-opacity hover:opacity-100"
                      title="Edit item"
                      onClick={() => setEditingItemId(task.id)}
                    >
                      <Pencil />
                      <span className="sr-only">Edit {task.title}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-destructive shrink-0 opacity-70 transition-opacity hover:opacity-100"
                      title="Remove item"
                      onClick={() =>
                        action.run(() =>
                          api.tasks.patch(householdId, task.id, { status: "cancelled" })
                        )
                      }
                    >
                      <Trash2 />
                      <span className="sr-only">Remove {task.title}</span>
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <CardFooter className="border-t bg-muted/20 p-3">
        <form
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const title = String(new FormData(form).get("title") ?? "").trim();
            if (!title) return;
            void action
              .run(() => api.tasks.create(householdId, { title, listId: list.id }))
              .then((ok) => {
                if (ok) form.reset();
              });
          }}
        >
          <Input
            className="min-w-0 bg-background"
            name="title"
            placeholder="Add an item…"
            required
          />
          <SubmitButton
            className="shrink-0"
            variant="secondary"
            size="icon"
            pending={action.pending}
            aria-label={`Add item to ${list.name}`}
          >
            <Plus />
          </SubmitButton>
        </form>
      </CardFooter>
    </Card>
  );
}

export function ListsTab({
  householdId,
  tz,
  lists,
  tasks,
}: {
  householdId: string;
  tz: string;
  lists: ListRow[];
  tasks: TaskRow[];
}) {
  const create = useAction(householdId);
  const totalItems = tasks.filter(
    (task) => task.list_id && task.status !== "cancelled"
  ).length;

  return (
    <div className="grid min-w-0 gap-5">
      <Card className="animate-fade-up gap-4 overflow-hidden">
        <CardHeader>
          <div className="bg-primary/10 text-primary mb-1 flex size-10 items-center justify-center rounded-lg">
            <ListPlus className="size-5" />
          </div>
          <CardTitle className="font-serif text-xl">Lists</CardTitle>
          <CardDescription>
            Keep groceries, errands, packing, and shared plans organized in one place.
          </CardDescription>
          {lists.length > 0 && (
            <CardAction className="flex gap-2">
              <Badge variant="secondary">
                {lists.length} {lists.length === 1 ? "list" : "lists"}
              </Badge>
              <Badge variant="outline">
                {totalItems} {totalItems === 1 ? "item" : "items"}
              </Badge>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          <form
            className="flex min-w-0 flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const name = String(new FormData(form).get("name") ?? "").trim();
              if (!name) return;
              void create.run(() => api.lists.create(householdId, name)).then((ok) => {
                if (ok) form.reset();
              });
            }}
          >
            <Input
              className="min-w-0"
              name="name"
              placeholder="Groceries, Costco, vacation…"
              aria-label="New list name"
              required
            />
            <SubmitButton className="sm:shrink-0" pending={create.pending}>
              <Plus />
              Create list
            </SubmitButton>
          </form>
        </CardContent>
      </Card>

      {lists.length === 0 ? (
        <Card className="animate-fade-up" style={{ animationDelay: "80ms" }}>
          <CardContent>
            <RobotEmptyState variant="juggling" caption="No lists yet. Create one above." />
          </CardContent>
        </Card>
      ) : (
        <div
          className="animate-fade-up grid min-w-0 items-start gap-4 xl:grid-cols-2"
          style={{ animationDelay: "80ms" }}
        >
          {lists.map((list) => (
            <ListCard
              key={list.id}
              householdId={householdId}
              tz={tz}
              list={list}
              tasks={tasks}
            />
          ))}
        </div>
      )}
    </div>
  );
}

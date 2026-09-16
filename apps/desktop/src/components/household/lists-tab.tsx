import { useState } from "react";
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { SubmitButton } from "@/components/submit-button";
import { RobotEmptyState } from "@/components/robot/scenes";
import {
  ListChecks,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAction } from "./use-actions";
import { CommentThread } from "./comment-thread";
import { ArtifactLink } from "./artifact-link";
import { ArtifactLinkChips, ArtifactSelect, listLinks } from "./artifact-links";
import { CreateSurface } from "./create-surface";
import { splitListItems, MAX_NEW_LIST_ITEMS } from "./list-items";
import type { EventRow, ListRow, TaskRow } from "./types";

function ListCard({
  householdId,
  tz,
  list,
  tasks,
  events,
}: {
  householdId: string;
  tz: string;
  list: ListRow;
  tasks: TaskRow[];
  events: EventRow[];
}) {
  const [renaming, setRenaming] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const action = useAction(householdId);
  const openCount = list.items.filter((item) => !item.completed_at).length;
  const orderedItems = [...list.items].sort((a, b) => {
    if (Boolean(a.completed_at) === Boolean(b.completed_at)) return a.sort_order - b.sort_order;
    return a.completed_at ? 1 : -1;
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
              <CardTitle className="truncate font-serif text-lg">
                <ArtifactLink type="list" id={list.id}>
                  {list.name}
                </ArtifactLink>
              </CardTitle>
              <CardDescription className="mt-1 flex flex-wrap items-center gap-2">
                <span>
                  {list.items.length} {list.items.length === 1 ? "item" : "items"}
                </span>
                <span aria-hidden>·</span>
                <span>{openCount} remaining</span>
              </CardDescription>
              <ArtifactLinkChips links={listLinks(list, { tasks, events })} className="col-span-full mt-2" />
            </div>
            <CardAction className="flex items-center gap-1">
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
        {orderedItems.length === 0 ? (
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
            {orderedItems.map((item) => (
              <div key={item.id} className="group flex min-w-0 items-center gap-3 px-4 py-3">
                <Checkbox
                  checked={Boolean(item.completed_at)}
                  aria-label={
                    item.completed_at
                      ? `Mark ${item.body} not done`
                      : `Mark ${item.body} done`
                  }
                  disabled={action.pending}
                  onCheckedChange={() =>
                    action.run(() =>
                      api.lists.patchItem(householdId, list.id, item.id, {
                        completed: !item.completed_at,
                      })
                    )
                  }
                />

                {editingItemId === item.id ? (
                  <form
                    className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const title = String(
                        new FormData(event.currentTarget).get("title") ?? ""
                      ).trim();
                      if (!title) return;
                      void action
                        .run(() => api.lists.patchItem(householdId, list.id, item.id, { body: title }))
                        .then((ok) => {
                          if (ok) setEditingItemId(null);
                        });
                    }}
                  >
                    <Input
                      className="h-8 min-w-0"
                      name="title"
                      defaultValue={item.body}
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
                        item.completed_at && "text-muted-foreground line-through"
                      )}
                    >
                      {item.body}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground shrink-0 opacity-70 transition-opacity hover:opacity-100"
                      title="Edit item"
                      onClick={() => setEditingItemId(item.id)}
                    >
                      <Pencil />
                      <span className="sr-only">Edit {item.body}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-destructive shrink-0 opacity-70 transition-opacity hover:opacity-100"
                      title="Remove item"
                      onClick={() =>
                        action.run(() => api.lists.removeItem(householdId, list.id, item.id))
                      }
                    >
                      <Trash2 />
                      <span className="sr-only">Remove {item.body}</span>
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
              .run(() => api.lists.addItems(householdId, list.id, [title]))
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

      <div className="border-t px-4 py-3">
        <CommentThread householdId={householdId} tz={tz} subject="list" subjectId={list.id} />
      </div>
    </Card>
  );
}

export function ListsTab({
  householdId,
  tz,
  lists,
  tasks,
  events,
}: {
  householdId: string;
  tz: string;
  lists: ListRow[];
  tasks: TaskRow[];
  events: EventRow[];
}) {
  const create = useAction(householdId);
  const [composerOpen, setComposerOpen] = useState(false);

  return (
    <div className="grid min-w-0 gap-5">
      <CreateSurface
        title="New list"
        description="Groceries, packing, errands — one item per line."
        triggerLabel="Create a list"
        open={composerOpen}
        onOpenChange={setComposerOpen}
      >
        <form
          className="grid gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            const name = String(data.get("name") ?? "").trim();
            if (!name) return;
            const items = splitListItems(String(data.get("items") ?? "")).slice(0, MAX_NEW_LIST_ITEMS);
            const taskId = String(data.get("task_id") ?? "") || null;
            const eventId = String(data.get("event_id") ?? "") || null;
            void create
              .run(async () => {
                const { list } = await api.lists.create(householdId, name, { taskId, eventId });
                if (items.length) await api.lists.addItems(householdId, list.id, items);
              })
              .then((ok) => {
                if (!ok) return;
                form.reset();
                setComposerOpen(false);
              });
          }}
        >
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="list-name">Name</FieldLabel>
              <Input
                id="list-name"
                name="name"
                placeholder="Groceries, Costco, vacation…"
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="list-items">Items</FieldLabel>
              <InputGroup>
                <InputGroupTextarea
                  id="list-items"
                  name="items"
                  placeholder={"milk\neggs\nbread"}
                  className="min-h-40"
                />
                <InputGroupAddon align="block-end" className="border-t">
                  <InputGroupText>One item per line</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <ArtifactSelect
                name="task_id"
                label="Link to task"
                emptyLabel="No task"
                options={tasks.filter((task) => task.status !== "cancelled").map((task) => ({ id: task.id, title: task.title }))}
              />
              <ArtifactSelect
                name="event_id"
                label="Link to event"
                emptyLabel="No event"
                options={events.map((event) => ({ id: event.id, title: event.title }))}
              />
            </div>
          </FieldGroup>
          <SubmitButton className="w-full sm:w-auto" pending={create.pending}>
            <Plus />
            Create list
          </SubmitButton>
        </form>
      </CreateSurface>

      {lists.length === 0 ? (
        <Card className="animate-fade-up">
          <CardContent>
            <RobotEmptyState caption="No lists yet. Create one above." />
          </CardContent>
        </Card>
      ) : (
        <div className="animate-fade-up grid min-w-0 items-start gap-4 xl:grid-cols-2">
          {lists.map((list) => (
            <ListCard
              key={list.id}
              householdId={householdId}
              tz={tz}
              list={list}
              tasks={tasks}
              events={events}
            />
          ))}
        </div>
      )}
    </div>
  );
}

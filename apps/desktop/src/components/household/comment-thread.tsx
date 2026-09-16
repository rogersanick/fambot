import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/submit-button";
import { RobotEmptyState } from "@/components/robot/scenes";
import { MemberAvatar } from "./member-avatar";
import { api, type CommentSubjectType } from "@/lib/api";
import { fmtWhen } from "@/lib/format";
import { cn } from "@/lib/utils";

const SUBJECT_LABEL: Record<CommentSubjectType, string> = {
  task: "task",
  event: "event",
  list: "list",
};

/**
 * Comment thread for a task, event, or list.
 *
 * Detail view (`variant="full"`): the whole thread is always visible.
 * Everywhere else (`variant="collapsed"`): a compact disclosure that expands
 * inline — never a modal.
 */
export function CommentThread({
  householdId,
  tz,
  subject,
  subjectId,
  variant = "collapsed",
  className,
  children,
}: {
  householdId: string;
  tz: string;
  subject: CommentSubjectType;
  subjectId: string;
  variant?: "full" | "collapsed";
  className?: string;
  /** Place the collapsed toggle in a parent row; the thread still expands below. */
  children?: (toggle: ReactNode) => ReactNode;
}) {
  const [open, setOpen] = useState(variant === "full");
  const [posting, setPosting] = useState(false);
  const queryClient = useQueryClient();
  const queryKey = ["household", householdId, "comments", subject, subjectId];
  const expanded = variant === "full" || open;

  const thread = useQuery({
    queryKey,
    queryFn: () => api.comments.list(householdId, subject, subjectId),
    enabled: expanded,
  });

  // API returns newest-first; the thread reads top-to-bottom chronologically.
  const commentRows = [...(thread.data?.comments ?? [])].reverse();
  const count = thread.data?.comments.length;
  const label = !count ? "Comments" : count === 1 ? "1 comment" : `${count} comments`;

  const body = (
    <div className={cn("grid gap-3", variant === "collapsed" && "pt-2")}>
      <div className={cn("grid gap-3", variant === "collapsed" && "max-h-64 overflow-y-auto pr-1")}>
        {thread.isPending && <p className="text-muted-foreground text-sm">Loading comments…</p>}
        {thread.isError && (
          <p className="text-destructive text-sm">Couldn't load comments. Try again.</p>
        )}
        {thread.isSuccess && commentRows.length === 0 && (
          variant === "full" ? (
            <RobotEmptyState caption="No comments yet. Add the first update." />
          ) : (
            <p className="text-muted-foreground text-sm">No comments yet. Add the first update.</p>
          )
        )}
        {commentRows.map((comment) => (
          <div key={comment.id} className="flex items-start gap-2.5">
            <MemberAvatar name={comment.authorName ?? "Fambot"} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="text-xs">
                <span className="font-medium">{comment.authorName ?? "Fambot"}</span>{" "}
                <span className="text-muted-foreground">{fmtWhen(comment.createdAt, tz)}</span>
              </p>
              <p className="text-sm whitespace-pre-wrap">{comment.body}</p>
            </div>
          </div>
        ))}
      </div>

      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const bodyText = String(new FormData(form).get("body") ?? "").trim();
          if (!bodyText) return;
          setPosting(true);
          api.comments
            .add(householdId, subject, subjectId, bodyText)
            .then(async () => {
              form.reset();
              await queryClient.invalidateQueries({ queryKey });
            })
            .catch((err) => {
              toast.error(err instanceof Error ? err.message : "Couldn't post the comment");
            })
            .finally(() => setPosting(false));
        }}
      >
        <Textarea
          name="body"
          placeholder="Add an update — e.g. “picked up the prescription, pharmacy closes at 6”"
          rows={variant === "full" ? 3 : 2}
          maxLength={4000}
          required
        />
        <SubmitButton pending={posting} size="sm" className="justify-self-end">
          Comment
        </SubmitButton>
      </form>
    </div>
  );

  if (variant === "full") {
    return (
      <section
        className={cn("grid gap-3 border-t pt-4", className)}
        aria-label={`Comments on this ${SUBJECT_LABEL[subject]}`}
      >
        <div>
          <h2 className="font-serif text-base">{label}</h2>
          <p className="text-muted-foreground text-xs">
            Status updates on this {SUBJECT_LABEL[subject]} — everyone in the household (and Fambot)
            can read them.
          </p>
        </div>
        {body}
      </section>
    );
  }

  const toggle = (
    <CollapsibleTrigger asChild>
      <button
        type="button"
        title={open ? "Hide comments" : "Show comments"}
        className={cn(
          "text-muted-foreground hover:text-foreground hover:bg-muted inline-flex shrink-0 items-center gap-1 rounded-md text-xs transition-colors",
          children ? "h-8 px-1.5 md:h-7" : "px-1 py-0.5",
          open && "text-foreground bg-muted"
        )}
      >
        <ChevronRight
          className="size-3.5 shrink-0 transition-transform group-data-[state=open]/comments:rotate-90"
          aria-hidden
        />
        <MessageSquare className="size-3.5 shrink-0" aria-hidden />
        {label}
      </button>
    </CollapsibleTrigger>
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn("group/comments", className)}>
      {children ? children(toggle) : toggle}
      <CollapsibleContent className="overflow-hidden">
        <div className={cn("bg-muted/40 mb-1 rounded-md px-2.5 py-2", children && "ml-2")}>
          {body}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

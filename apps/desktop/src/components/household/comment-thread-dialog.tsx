import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/submit-button";
import { RobotEmptyState } from "@/components/robot/scenes";
import { MemberAvatar } from "./member-avatar";
import { api, type CommentSubjectType } from "@/lib/api";
import { fmtWhen } from "@/lib/format";

const SUBJECT_LABEL: Record<CommentSubjectType, string> = {
  task: "todo",
  event: "event",
  list: "list",
};

/**
 * Comment thread for a task, event, or list, opened from `trigger`.
 * Comments are append-only status updates visible to the whole household
 * (and readable by Fambot when someone asks for the latest status).
 */
export function CommentThreadDialog({
  householdId,
  tz,
  subject,
  subjectId,
  title,
  trigger,
}: {
  householdId: string;
  tz: string;
  subject: CommentSubjectType;
  subjectId: string;
  title: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const queryClient = useQueryClient();
  const queryKey = ["household", householdId, "comments", subject, subjectId];

  const thread = useQuery({
    queryKey,
    queryFn: () => api.comments.list(householdId, subject, subjectId),
    enabled: open,
  });

  // API returns newest-first; the thread reads top-to-bottom chronologically.
  const commentRows = [...(thread.data?.comments ?? [])].reverse();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-serif">{title}</DialogTitle>
          <DialogDescription>
            Status updates on this {SUBJECT_LABEL[subject]} — everyone in the household (and
            Fambot) can read them.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-72 gap-3 overflow-y-auto pr-1">
          {thread.isPending && <p className="text-muted-foreground text-sm">Loading comments…</p>}
          {thread.isError && (
            <p className="text-destructive text-sm">Couldn't load comments. Try again.</p>
          )}
          {thread.isSuccess && commentRows.length === 0 && (
            <RobotEmptyState variant="painting" caption="No comments yet. Add the first update." />
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
            const body = String(new FormData(form).get("body") ?? "").trim();
            if (!body) return;
            setPosting(true);
            api.comments
              .add(householdId, subject, subjectId, body)
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
            rows={2}
            maxLength={4000}
            required
          />
          <SubmitButton pending={posting} className="justify-self-end">
            Comment
          </SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Empty checkbox + label so completing a task is explicit, not a tiny pre-checked hit target. */
export function CompleteTaskButton({
  pending,
  onComplete,
  className,
}: {
  pending?: boolean;
  onComplete: () => void;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={onComplete}
      className={cn(
        "text-muted-foreground hover:text-foreground h-11 shrink-0 gap-2 px-3 text-sm md:h-8 md:px-2.5 md:text-xs",
        className
      )}
    >
      <span className="border-input bg-background size-4 rounded-[4px] border shadow-xs" aria-hidden />
      Complete
    </Button>
  );
}

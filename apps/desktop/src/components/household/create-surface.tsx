import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/lib/use-mobile";

/**
 * Desktop: the usual titled card. Phone: a full-width button that opens the
 * same form in a bottom sheet so the list stays the primary surface.
 */
export function CreateSurface({
  title,
  description,
  triggerLabel,
  children,
  open,
  onOpenChange,
}: {
  title: string;
  description?: string;
  triggerLabel: string;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetTrigger asChild>
          <Button type="button" className="h-11 w-full gap-2">
            <Plus className="size-4" />
            {triggerLabel}
          </Button>
        </SheetTrigger>
        <SheetContent
          side="bottom"
          className="max-h-[90dvh] gap-0 overflow-y-auto rounded-t-xl pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <SheetHeader>
            <SheetTitle className="font-serif">{title}</SheetTitle>
            {description && <SheetDescription>{description}</SheetDescription>}
          </SheetHeader>
          <div className="px-4 pb-4">{children}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Card className="animate-fade-up">
      <CardHeader>
        <CardTitle className="font-serif text-lg">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

import {
  Bell,
  CalendarDays,
  CheckSquare,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  MoreHorizontal,
  Plug,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { MORE_TABS, isMoreTab, type DashboardTab } from "./dashboard-tabs";

type PrimaryTab = "overview" | "chat" | "tasks" | "calendar";

const PRIMARY: Array<{ value: PrimaryTab; label: string; icon: typeof LayoutDashboard }> = [
  { value: "overview", label: "Overview", icon: LayoutDashboard },
  { value: "chat", label: "Chat", icon: MessageSquare },
  { value: "tasks", label: "Tasks", icon: CheckSquare },
  { value: "calendar", label: "Calendar", icon: CalendarDays },
];

const MORE_ICON = {
  lists: ListChecks,
  reminders: Bell,
  connections: Plug,
  settings: Settings,
} as const satisfies Record<(typeof MORE_TABS)[number], typeof ListChecks>;

const MORE = MORE_TABS.map((value) => ({
  value,
  label: value.charAt(0).toUpperCase() + value.slice(1),
  icon: MORE_ICON[value],
}));

export function MobileTabBar({
  value,
  onChange,
  moreOpen,
  onMoreOpenChange,
}: {
  value: DashboardTab;
  onChange: (tab: DashboardTab) => void;
  moreOpen: boolean;
  onMoreOpenChange: (open: boolean) => void;
}) {
  const moreActive = isMoreTab(value);

  return (
    <>
      <nav
        className="bg-background/95 border-border shrink-0 border-t backdrop-blur-md"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Household"
      >
        <ul className="grid h-14 grid-cols-5">
          {PRIMARY.map((item) => {
            const active = value === item.value;
            const Icon = item.icon;
            return (
              <li key={item.value}>
                <button
                  type="button"
                  onClick={() => onChange(item.value)}
                  className={cn(
                    "flex h-full w-full flex-col items-center justify-center gap-0.5 text-[10px] font-medium",
                    active ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  <Icon className="size-5" />
                  {item.label}
                </button>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => onMoreOpenChange(true)}
              className={cn(
                "flex h-full w-full flex-col items-center justify-center gap-0.5 text-[10px] font-medium",
                moreActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              <MoreHorizontal className="size-5" />
              More
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={moreOpen} onOpenChange={onMoreOpenChange}>
        <SheetContent
          side="bottom"
          className="rounded-t-xl pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <SheetHeader>
            <SheetTitle className="font-serif">More</SheetTitle>
            <SheetDescription>Lists, reminders, connections, and household settings.</SheetDescription>
          </SheetHeader>
          <div className="grid gap-1 px-4 pb-2">
            {MORE.map((item) => {
              const Icon = item.icon;
              const active = value === item.value;
              return (
                <Button
                  key={item.value}
                  type="button"
                  variant={active ? "secondary" : "ghost"}
                  className="h-12 justify-start gap-3 text-base"
                  onClick={() => {
                    onChange(item.value);
                    onMoreOpenChange(false);
                  }}
                >
                  <Icon className="size-5" />
                  {item.label}
                </Button>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

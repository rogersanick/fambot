import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const PALETTE = [
  "bg-chart-1/20 text-chart-1",
  "bg-chart-2/20 text-chart-2",
  "bg-chart-3/25 text-chart-3",
  "bg-chart-4/20 text-chart-4",
  "bg-chart-5/25 text-chart-5",
];

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/** Initials avatar with a deterministic nature-palette tint per member. */
export function MemberAvatar({
  name,
  size = "sm",
  className,
}: {
  name: string;
  size?: "sm" | "default" | "lg";
  className?: string;
}) {
  const tint = PALETTE[hashName(name) % PALETTE.length];
  return (
    <Avatar size={size} className={className}>
      <AvatarFallback className={cn("font-medium", tint)}>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

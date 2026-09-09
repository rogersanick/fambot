import { cn } from "@/lib/utils";

const ART = {
  /* A sprout: all clear, things are growing. */
  sprout: ["    _ _", "   (_\\_)", "    \\ /", "     Y", " ____|____"].join("\n"),
  /* A calm sun on the horizon. */
  sun: ["   \\  |  /", "    .---.", " --(     )--", "    '---'", "   /  |  \\"].join("\n"),
  /* A quiet bell. */
  bell: ["     __", "    /  \\", "   |    |", "   |____|", "    \\()/"].join("\n"),
  /* A cozy teapot for anything else. */
  teapot: ["      ___", "   __(   )__", "  /  |     | \\", "  \\_ |_____|_/", "      '---'"].join("\n"),
} as const;

type AsciiEmptyStateProps = {
  variant: keyof typeof ART;
  caption: string;
  className?: string;
};

/** Playful ASCII scene shown when a list has nothing in it. */
export function AsciiEmptyState({ variant, caption, className }: AsciiEmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-3 py-8 text-muted-foreground", className)}>
      <pre className="animate-gentle-pulse font-mono text-xs leading-tight select-none" aria-hidden>
        {ART[variant]}
      </pre>
      <p className="text-sm">{caption}</p>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Braille-dot terminal spinner for pending states. */
export function AsciiSpinner({ className }: { className?: string }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 80);
    return () => clearInterval(t);
  }, []);

  return (
    <span className={cn("font-mono", className)} aria-hidden>
      {FRAMES[frame]}
    </span>
  );
}

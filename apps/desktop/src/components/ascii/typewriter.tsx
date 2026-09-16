"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type TypewriterProps = {
  /** Lines typed one after another, each on its own row. */
  lines: string[];
  /** Milliseconds per character. */
  speed?: number;
  /** Delay before typing begins. */
  startDelay?: number;
  /** Pause between lines. */
  linePause?: number;
  className?: string;
  cursorClassName?: string;
};

/** Types out lines of text with a blinking block cursor, terminal-style. */
export function Typewriter({
  lines,
  speed = 18,
  startDelay = 250,
  linePause = 260,
  className,
  cursorClassName,
}: TypewriterProps) {
  const total = useMemo(() => lines.reduce((n, l) => n + l.length, 0), [lines]);
  const [count, setCount] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let typed = 0;
    // Character positions where a line ends, to insert a pause.
    const lineEnds = new Set<number>();
    let acc = 0;
    for (const l of lines) {
      acc += l.length;
      lineEnds.add(acc);
    }
    // Reset happens inside the timeout chain (never synchronously in the effect).
    const tick = () => {
      typed += 1;
      setCount(typed);
      if (typed >= total) return;
      timer.current = setTimeout(tick, lineEnds.has(typed) ? linePause : speed);
    };
    timer.current = setTimeout(tick, startDelay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [lines, speed, startDelay, linePause, total]);

  const done = count >= total;
  const rendered: React.ReactNode[] = [];
  let remaining = count;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (remaining <= 0) break;
    const visible = line.slice(0, remaining);
    const isActive = remaining <= line.length && !done;
    rendered.push(
      <div key={i} className="truncate">
        {visible}
        {isActive && (
          <span className={cn("animate-caret-blink inline-block", cursorClassName)} aria-hidden>
            &#9608;
          </span>
        )}
      </div>,
    );
    remaining -= line.length;
  }

  return (
    <div className={cn("font-mono whitespace-pre-wrap", className)}>
      {rendered}
    </div>
  );
}

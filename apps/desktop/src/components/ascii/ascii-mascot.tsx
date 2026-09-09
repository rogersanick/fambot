"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const IDLE = String.raw`   ⌐
 ╭─┴─╮
 │o o│
 │ ‿ │
 ╰───╯`;

const BLINK = String.raw`   ⌐
 ╭─┴─╮
 │- -│
 │ ‿ │
 ╰───╯`;

const HAPPY = String.raw`   ¡
 ╭─┴─╮
 │^ ^│
 │ ‿ │
 ╰───╯`;

/* Mostly idle, occasional blink, rare happy wiggle. */
const SEQUENCE = [IDLE, IDLE, IDLE, BLINK, IDLE, IDLE, HAPPY, IDLE, BLINK, IDLE];

/** A tiny animated ASCII robot that blinks and perks up on a loop. */
export function AsciiMascot({ className }: { className?: string }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setFrame((f) => (f + 1) % SEQUENCE.length), 900);
    return () => clearInterval(t);
  }, []);

  return (
    <pre className={cn("font-mono leading-tight select-none", className)} aria-label="FamBot mascot" role="img">
      {SEQUENCE[frame]}
    </pre>
  );
}

import { useState } from "react";
import { RobotMascot } from "@/components/robot/mascot";
import { Typewriter } from "@/components/ascii/typewriter";
import { FambotLogo } from "@/components/robot/logo";

type TerminalHeroProps = {
  /** Boot-sequence lines, typed one by one. */
  lines: string[];
};

/**
 * The FamBot "greenhouse computer": a phosphor-green terminal panel that
 * boots up with the household's live status.
 */
export function TerminalHero({ lines }: TerminalHeroProps) {
  // This is a boot snapshot, not a live dashboard. Keeping the first set of
  // lines prevents CRUD/query invalidations from replaying the typewriter.
  const [bootLines] = useState(lines);

  return (
    <section className="bg-terminal border-terminal-border animate-fade-up relative overflow-hidden rounded-xl border p-4 shadow-sm sm:p-5">
      <RobotMascot className="text-terminal-dim absolute top-3 right-4 hidden sm:block" />
      <FambotLogo className="text-terminal-foreground h-8 sm:h-11" />
      <Typewriter
        lines={bootLines}
        className="text-terminal-dim mt-3 text-xs sm:text-sm"
        cursorClassName="text-terminal-foreground"
      />
    </section>
  );
}

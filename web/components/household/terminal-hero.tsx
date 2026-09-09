import { AsciiMascot } from "@/components/ascii/ascii-mascot";
import { Typewriter } from "@/components/ascii/typewriter";
import { FAMBOT_BANNER } from "@/components/ascii/banner";

type TerminalHeroProps = {
  /** Boot-sequence lines, typed one by one. */
  lines: string[];
};

/**
 * The FamBot "greenhouse computer": a phosphor-green terminal panel that
 * boots up with the household's live status.
 */
export function TerminalHero({ lines }: TerminalHeroProps) {
  return (
    <section className="bg-terminal border-terminal-border animate-fade-up relative overflow-hidden rounded-xl border p-4 shadow-sm sm:p-5">
      <AsciiMascot className="text-terminal-dim absolute top-3 right-4 hidden text-[10px] sm:block" />
      <pre
        className="text-terminal-foreground text-[7px] leading-[1.15] font-bold select-none sm:text-[10px]"
        aria-label="FamBot"
        role="img"
      >
        {FAMBOT_BANNER}
      </pre>
      <Typewriter
        lines={lines}
        className="text-terminal-dim mt-3 text-xs sm:text-sm"
        cursorClassName="text-terminal-foreground"
      />
    </section>
  );
}

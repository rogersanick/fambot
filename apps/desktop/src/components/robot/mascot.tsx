import { cn } from "@/lib/utils";

const MONO = 'var(--font-mono, "Fira Code", ui-monospace, monospace)';

function T({ x, y, s, className }: { x: number; y: number; s: string; className?: string }) {
  return (
    <text x={x} y={y} xmlSpace="preserve" fontFamily={MONO} fontSize="10" fill="currentColor" className={className}>
      {s}
    </text>
  );
}

/**
 * The Fambot mascot in glyph form: mostly idle, blinks, occasionally perks up
 * with a happy wiggle. ASCII look, SVG smoothness — rigid transforms and
 * opacity frame-swaps only.
 */
export function RobotMascot({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 58" width="40" className={cn("select-none", className)} role="img" aria-label="Fambot mascot">
      <style>{`
.fbm-all{animation:fbm-wiggle 9s ease-in-out infinite;transform-origin:24px 50px}
@keyframes fbm-wiggle{0%,58%,72%,100%{transform:rotate(0)}62%{transform:rotate(-6deg)}67%{transform:rotate(5deg)}}
.fbm-idle{animation:fbm-idle 9s steps(1) infinite}
@keyframes fbm-idle{0%,100%{opacity:1}30%,33%{opacity:0}34%{opacity:1}60%,70%{opacity:0}71%{opacity:1}}
.fbm-blink{animation:fbm-blink 9s steps(1) infinite;opacity:0}
@keyframes fbm-blink{0%,100%{opacity:0}30%,33%{opacity:1}34%{opacity:0}}
.fbm-happy{animation:fbm-happy 9s steps(1) infinite;opacity:0}
@keyframes fbm-happy{0%,100%{opacity:0}60%,70%{opacity:1}71%{opacity:0}}
@media (prefers-reduced-motion: reduce){.fbm-all,.fbm-all *{animation:none!important}}`}</style>
      <g className="fbm-all">
        <T x={15} y={9} s="⌐" />
        <T x={9} y={19} s="╭─┴─╮" />
        <T x={9} y={29} s="│" />
        <T x={33} y={29} s="│" />
        <T x={15} y={29} s="o o" className="fbm-idle" />
        <T x={15} y={29} s="- -" className="fbm-blink" />
        <T x={15} y={29} s="^ ^" className="fbm-happy" />
        <T x={9} y={39} s="│ ‿ │" />
        <T x={9} y={49} s="╰───╯" />
      </g>
    </svg>
  );
}

import { cn } from "@/lib/utils";

/**
 * Fambot wordmark: robot head + monospace lettering. Replaces the old ASCII
 * banner; colors follow currentColor so `text-primary` / terminal classes
 * style it. The robot blinks, because of course it does.
 */
export function FambotLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 190 52" className={cn("h-12 w-auto select-none", className)} role="img" aria-label="FamBot">
      <style>{`
.fbl-eyes{animation:fbl-blink 4.6s infinite;transform-origin:27px 31px}
@keyframes fbl-blink{0%,92%,100%{transform:scaleY(1)}95%,97%{transform:scaleY(.15)}}
.fbl-bobble{animation:fbl-bob 2.8s ease-in-out infinite}
@keyframes fbl-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.6px)}}
@media (prefers-reduced-motion: reduce){svg .fbl-eyes,svg .fbl-bobble{animation:none}}`}</style>
      <g fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <line x1="27" y1="17" x2="27" y2="9" />
        <circle className="fbl-bobble" cx="27" cy="6.5" r="3" fill="currentColor" stroke="none" />
        <rect x="9" y="17" width="36" height="28" rx="9" />
        <g className="fbl-eyes" fill="currentColor" stroke="none">
          <circle cx="21" cy="31" r="3" />
          <circle cx="33" cy="31" r="3" />
        </g>
        <path d="M22 38 q5 4 10 0" strokeWidth="2" />
      </g>
      <text
        x="56"
        y="40"
        fontFamily="var(--font-mono, ui-monospace, monospace)"
        fontWeight="700"
        fontSize="30"
        letterSpacing="3"
        fill="currentColor"
      >
        FAMBOT
      </text>
    </svg>
  );
}

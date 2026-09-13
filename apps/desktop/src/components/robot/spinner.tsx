import { cn } from "@/lib/utils";

/**
 * Inline pending indicator: a little robot gear turning at 1em. Replaces the
 * old braille-dot ASCII spinner; pure CSS animation, colors via currentColor.
 */
export function RobotSpinner({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      className={cn("inline-block align-[-0.125em]", className)}
      aria-hidden
    >
      <style>{`
.fb-gear{animation:fb-gear-spin 1.1s linear infinite;transform-origin:12px 12px}
@keyframes fb-gear-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.fb-gear{animation:none}}`}</style>
      <g className="fb-gear" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="5.5" fill="none" />
        <line x1="12" y1="1.5" x2="12" y2="4.5" />
        <line x1="12" y1="19.5" x2="12" y2="22.5" />
        <line x1="1.5" y1="12" x2="4.5" y2="12" />
        <line x1="19.5" y1="12" x2="22.5" y2="12" />
        <line x1="4.6" y1="4.6" x2="6.7" y2="6.7" />
        <line x1="17.3" y1="17.3" x2="19.4" y2="19.4" />
        <line x1="19.4" y1="4.6" x2="17.3" y2="6.7" />
        <line x1="6.7" y1="17.3" x2="4.6" y2="19.4" />
      </g>
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}

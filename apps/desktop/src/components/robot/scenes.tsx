import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Fambot empty-state scenes: the robot competes in Olympic sports,
 * one event at a time, picked at random.
 *
 * Styled like ASCII art — every shape is a monospace glyph on a 6px column
 * grid — but rendered as SVG so motion is smooth. Animation is strictly rigid
 * (translate/rotate) plus opacity frame-swaps: nothing stretches or resizes.
 * Colors follow currentColor with sparse var(--primary) accents; everything
 * pauses under prefers-reduced-motion.
 */

export const ROBOT_SCENE_VARIANTS = [
  "sprint",
  "swimming",
  "gymnastics",
  "weightlifting",
  "archery",
  "fencing",
  "skateboarding",
  "diving",
  "tabletennis",
] as const;

export type RobotSceneVariant = (typeof ROBOT_SCENE_VARIANTS)[number];

const MONO = 'var(--font-mono, "Fira Code", ui-monospace, monospace)';
const SCENE_MS = 8000;

type TProps = { x: number; y: number; s: string; className?: string; fill?: string };

/** One run of monospace glyphs. 10px font → 6px per column. */
function T({ x, y, s, className, fill = "currentColor" }: TProps) {
  return (
    <text x={x} y={y} xmlSpace="preserve" fontFamily={MONO} fontSize="10" fill={fill} className={className}>
      {s}
    </text>
  );
}

const SHARED_CSS = `
@keyframes fbg-open{0%,90%,97%,100%{opacity:1}92%,95%{opacity:0}}
.fbg-open{animation:fbg-open 4.4s infinite}
@keyframes fbg-shut{0%,90%,97%,100%{opacity:0}92%,95%{opacity:1}}
.fbg-shut{animation:fbg-shut 4.4s infinite;opacity:0}
@media (prefers-reduced-motion: reduce){.fb-scene *{animation:none!important}}
`;

function SceneShell({ css, children }: { css: string; children: ReactNode }) {
  return (
    <svg viewBox="0 0 160 100" width="190" className="fb-scene overflow-visible" aria-hidden>
      <style>{`${SHARED_CSS}${css}`}</style>
      {children}
    </svg>
  );
}

/**
 * The glyph robot, feet on y=88. `x` is the head's center column. Arms are
 * scene-specific; `eyes`/`legs` can be overridden for reaction frames.
 */
function GlyphBot({ x, eyes, legs }: { x: number; eyes?: ReactNode; legs?: ReactNode }) {
  return (
    <>
      <T x={x - 3} y={30} s="¡" fill="var(--primary)" />
      <T x={x - 15} y={40} s="╭─┴─╮" />
      <T x={x - 15} y={50} s="│" />
      <T x={x + 9} y={50} s="│" />
      {eyes ?? (
        <>
          <T x={x - 9} y={50} s="o o" className="fbg-open" />
          <T x={x - 9} y={50} s="- -" className="fbg-shut" />
        </>
      )}
      <T x={x - 15} y={60} s="├───┤" />
      <T x={x - 15} y={70} s="│" />
      <T x={x + 9} y={70} s="│" />
      <T x={x - 3} y={70} s="▪" fill="var(--primary)" />
      <T x={x - 15} y={80} s="╰┬─┬╯" />
      {legs ?? <T x={x - 9} y={88} s="╱ ╲" />}
    </>
  );
}

function Ground({ from = 4, cols = 25 }: { from?: number; cols?: number }) {
  return <T x={from} y={92} s={"─".repeat(cols)} className="opacity-40" />;
}

function pickRandomScene(exclude?: RobotSceneVariant): RobotSceneVariant {
  const pool = exclude ? ROBOT_SCENE_VARIANTS.filter((v) => v !== exclude) : ROBOT_SCENE_VARIANTS;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

/** 100m dash — crouched on the blocks until the gun, then a messy sprint. */
function SprintScene() {
  return (
    <SceneShell
      css={`
.fbsp-set{animation:fbsp-set 6.6s ease-in-out infinite;transform-origin:78px 88px}
@keyframes fbsp-set{0%,18%{transform:rotate(28deg) translate(6px,3px)}26%,100%{transform:rotate(0) translate(0,0)}}
.fbsp-bob{animation:fbsp-bob 6.6s ease-in-out infinite}
@keyframes fbsp-bob{0%,24%{transform:translateY(0)}28%,32%,36%,40%,44%,48%,52%,56%,60%,64%,68%,72%,76%,80%,84%,88%,92%{transform:translateY(-3px)}30%,34%,38%,42%,46%,50%,54%,58%,62%,66%,70%,74%,78%,82%,86%,90%,94%,100%{transform:translateY(0)}}
.fbsp-crouch{animation:fbsp-crouch 6.6s infinite}
@keyframes fbsp-crouch{0%,20%{opacity:1}24%,100%{opacity:0}}
.fbsp-run{animation:fbsp-run 6.6s infinite;opacity:0}
@keyframes fbsp-run{0%,22%{opacity:0}26%,100%{opacity:1}}
.fbsp-legA{animation:fbsp-legA .28s steps(1) infinite}
@keyframes fbsp-legA{0%,100%{opacity:1}50%{opacity:0}}
.fbsp-legB{animation:fbsp-legB .28s steps(1) infinite;opacity:0}
@keyframes fbsp-legB{0%,100%{opacity:0}50%{opacity:1}}
.fbsp-armL{animation:fbsp-armL .28s ease-in-out infinite;transform-origin:63px 58px}
@keyframes fbsp-armL{0%,100%{transform:rotate(-28deg)}50%{transform:rotate(18deg)}}
.fbsp-armR{animation:fbsp-armR .28s ease-in-out infinite;transform-origin:93px 58px}
@keyframes fbsp-armR{0%,100%{transform:rotate(18deg)}50%{transform:rotate(-28deg)}}
.fbsp-track{animation:fbsp-track 6.6s linear infinite}
@keyframes fbsp-track{0%,22%{transform:translateX(0)}100%{transform:translateX(-160px)}}
.fbsp-tape{animation:fbsp-tape 6.6s linear infinite;transform-origin:148px 50px}
@keyframes fbsp-tape{0%,70%{transform:translateX(0) rotate(0);opacity:1}86%{transform:translateX(-70px) rotate(0);opacity:1}90%{transform:translateX(-78px) rotate(55deg);opacity:.4}94%,100%{opacity:0;transform:translateX(-78px) rotate(70deg)}}
.fbsp-flash{animation:fbsp-flash 6.6s infinite;opacity:0}
@keyframes fbsp-flash{0%,18%,32%,100%{opacity:0}20%,28%{opacity:1}}
.fbsp-smoke{animation:fbsp-smoke 6.6s ease-out infinite;opacity:0}
@keyframes fbsp-smoke{0%,19%{opacity:0;transform:translate(0,0)}21%{opacity:1;transform:translate(4px,-6px)}28%{opacity:0;transform:translate(8px,-14px)}100%{opacity:0}}
.fbsp-bg{animation:fbsp-track 6.6s linear infinite}
.fbsp-gun{animation:fbsp-gun 6.6s ease-in-out infinite;transform-origin:32px 58px}
@keyframes fbsp-gun{0%,18%{transform:rotate(-58deg)}21%{transform:rotate(-78deg)}28%,100%{transform:rotate(-48deg)}}
.fbsp-kick{animation:fbsp-kick 6.6s ease-in-out infinite;transform-origin:16px 88px}
@keyframes fbsp-kick{0%,18%,30%,100%{transform:rotate(0)}21%,24%{transform:rotate(-7deg)}}`}
    >
      <g className="fbsp-track">
        <T x={-20} y={92} s={"═  ".repeat(16)} className="opacity-35" />
        <T x={-8} y={96} s={"═  ".repeat(16)} className="opacity-25" />
      </g>
      <g className="fbsp-tape">
        <T x={142} y={48} s="┃" />
        <T x={136} y={58} s="══" fill="var(--primary)" />
        <T x={142} y={68} s="┃" />
      </g>
      {/* official — background character, scrolls off once the race starts */}
      <g className="fbsp-bg">
        <g className="fbsp-kick">
          <T x={2} y={40} s="╭─┴─╮" className="opacity-45" />
          <T x={2} y={50} s="│ o │" className="opacity-45" />
          <T x={2} y={60} s="├───┤" className="opacity-45" />
          <T x={2} y={70} s="│   │" className="opacity-45" />
          <T x={2} y={80} s="╰┬─┬╯" className="opacity-45" />
          <T x={8} y={88} s="╱ ╲" className="opacity-45" />
          <g className="fbsp-gun">
            <T x={32} y={58} s="──" className="opacity-45" />
            <T x={44} y={58} s="═o" className="opacity-55" />
            <T x={56} y={54} s="*" className="fbsp-flash" fill="var(--primary)" />
            <T x={53} y={46} s="˚" className="fbsp-smoke" fill="var(--primary)" />
          </g>
        </g>
        <T x={46} y={22} s="BANG" className="fbsp-flash" fill="var(--primary)" />
        <T x={58} y={90} s="▁" className="opacity-40" />
        <T x={82} y={90} s="▁" className="opacity-40" />
      </g>
      <g className="fbsp-set">
        <g className="fbsp-bob">
          <GlyphBot
            x={78}
            legs={
              <>
                <T x={69} y={88} s="╭ ╲" className="fbsp-crouch" />
                <g className="fbsp-run">
                  <T x={69} y={88} s="╱ ╲" className="fbsp-legA" />
                  <T x={69} y={88} s="│ ╱" className="fbsp-legB" />
                </g>
              </>
            }
          />
          <g className="fbsp-crouch">
            <T x={57} y={78} s="╲" />
            <T x={51} y={88} s="▾" />
            <T x={93} y={72} s="─" />
          </g>
          <g className="fbsp-run">
            <g className="fbsp-armL">
              <T x={57} y={62} s="╱" />
            </g>
            <g className="fbsp-armR">
              <T x={93} y={62} s="╲" />
            </g>
          </g>
        </g>
      </g>
    </SceneShell>
  );
}

/** Pool length — robot on its side, freestyle, one stiff lap at a time. */
function SwimmingScene() {
  return (
    <SceneShell
      css={`
.fbsw-lane{animation:fbsw-lane 1.6s linear infinite}
@keyframes fbsw-lane{0%{transform:translateX(0)}100%{transform:translateX(-18px)}}
.fbsw-lap{animation:fbsw-lap 6.8s linear infinite}
@keyframes fbsw-lap{
  0%,6%{transform:translateX(8px);opacity:1}
  82%{transform:translateX(48px);opacity:1}
  88%{transform:translateX(52px);opacity:0}
  90%{transform:translateX(8px);opacity:0}
  94%,100%{transform:translateX(8px);opacity:1}}
.fbsw-side{transform:rotate(90deg);transform-origin:48px 58px}
.fbsw-bob{animation:fbsw-bob .9s ease-in-out infinite}
@keyframes fbsw-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(3px)}}
.fbsw-armA{animation:fbsw-armA .9s ease-in-out infinite;transform-origin:63px 58px}
@keyframes fbsw-armA{0%{transform:rotate(80deg)}50%{transform:rotate(-70deg)}100%{transform:rotate(80deg)}}
.fbsw-armB{animation:fbsw-armB .9s ease-in-out infinite;transform-origin:33px 58px}
@keyframes fbsw-armB{0%{transform:rotate(-70deg)}50%{transform:rotate(80deg)}100%{transform:rotate(-70deg)}}
.fbsw-kickA{animation:fbsw-kickA .28s steps(1) infinite}
@keyframes fbsw-kickA{0%,100%{opacity:1}50%{opacity:0}}
.fbsw-kickB{animation:fbsw-kickB .28s steps(1) infinite;opacity:0}
@keyframes fbsw-kickB{0%,100%{opacity:0}50%{opacity:1}}
.fbsw-bub{animation:fbsw-bub .9s ease-in-out infinite}
@keyframes fbsw-bub{0%,100%{opacity:.35;transform:translate(0,0)}50%{opacity:1;transform:translate(-4px,-2px)}}`}
    >
      <defs>
        <clipPath id="fbsw-pool">
          <rect x="10" y="16" width="140" height="74" />
        </clipPath>
      </defs>
      <T x={4} y={14} s="┌────────────────────────┐" className="opacity-40" />
      <T x={4} y={24} s="│" className="opacity-40" />
      <T x={148} y={24} s="│" className="opacity-40" />
      <T x={4} y={40} s="│" className="opacity-40" />
      <T x={148} y={40} s="│" className="opacity-40" />
      <T x={4} y={56} s="│" className="opacity-40" />
      <T x={148} y={56} s="│" className="opacity-40" />
      <T x={4} y={72} s="│" className="opacity-40" />
      <T x={148} y={72} s="│" className="opacity-40" />
      <T x={4} y={88} s="└────────────────────────┘" className="opacity-40" />
      <g clipPath="url(#fbsw-pool)">
        <g className="fbsw-lane">
          <T x={-12} y={26} s={"· · ".repeat(14)} className="opacity-30" />
        </g>
        <T x={10} y={40} s="~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~" className="opacity-35" />
        <T x={10} y={56} s="≈  ≈  ≈  ≈  ≈  ≈  ≈" className="opacity-30" />
        <T x={16} y={72} s="≈  ≈  ≈  ≈  ≈  ≈  ≈" className="opacity-25" />
        <g className="fbsw-lap">
          <g className="fbsw-bob">
            <g className="fbsw-side">
              <GlyphBot
                x={48}
                eyes={<T x={39} y={50} s="> <" />}
                legs={
                  <>
                    <T x={39} y={88} s="~ ~" className="fbsw-kickA" fill="var(--primary)" />
                    <T x={39} y={88} s="≈ ≈" className="fbsw-kickB" fill="var(--primary)" />
                  </>
                }
              />
              <g className="fbsw-armA">
                <T x={63} y={60} s="─╯" />
              </g>
              <g className="fbsw-armB">
                <T x={21} y={60} s="╰─" />
              </g>
              <T x={20} y={84} s="˚˚" className="fbsw-bub" fill="var(--primary)" />
            </g>
          </g>
        </g>
      </g>
    </SceneShell>
  );
}

/** Vault — a clean run-up, one rotation over the horse, a stuck landing. */
function GymnasticsScene() {
  return (
    <SceneShell
      css={`
.fbgy-bot{animation:fbgy-bot 7.2s linear infinite;transform-origin:32px 58px}
@keyframes fbgy-bot{
  0%{transform:translate(-40px,0) rotate(0);opacity:0}
  5%{transform:translate(-40px,0) rotate(0);opacity:1}
  10%{transform:translate(-18px,0) rotate(0);opacity:1}
  16%{transform:translate(-2px,0) rotate(0)}
  22%{transform:translate(12px,0) rotate(0)}
  28%{transform:translate(24px,0) rotate(0)}
  32%{transform:translate(30px,3px) rotate(-6deg)}
  38%{transform:translate(40px,-16px) rotate(-40deg)}
  44%{transform:translate(52px,-38px) rotate(-100deg)}
  50%{transform:translate(64px,-50px) rotate(-160deg)}
  56%{transform:translate(76px,-52px) rotate(-220deg)}
  62%{transform:translate(88px,-38px) rotate(-280deg)}
  68%{transform:translate(98px,-16px) rotate(-330deg)}
  74%{transform:translate(104px,0) rotate(-360deg)}
  80%{transform:translate(104px,0) rotate(-360deg)}
  88%{transform:translate(132px,0) rotate(-360deg);opacity:1}
  93%{transform:translate(158px,0) rotate(-360deg);opacity:0}
  94%{transform:translate(-40px,0) rotate(0);opacity:0}
  100%{transform:translate(-40px,0) rotate(0);opacity:0}}
.fbgy-legA{animation:fbgy-legA .32s steps(1) infinite}
@keyframes fbgy-legA{0%,100%{opacity:1}50%{opacity:0}}
.fbgy-legB{animation:fbgy-legB .32s steps(1) infinite;opacity:0}
@keyframes fbgy-legB{0%,100%{opacity:0}50%{opacity:1}}
.fbgy-arms{animation:fbgy-arms 7.2s infinite}
@keyframes fbgy-arms{0%,73%,82%,100%{opacity:0}76%,80%{opacity:1}}
.fbgy-run{animation:fbgy-run 7.2s infinite}
@keyframes fbgy-run{0%,32%{opacity:1}35%,80%{opacity:0}83%,93%{opacity:1}95%,100%{opacity:0}}
.fbgy-score{animation:fbgy-score 7.2s infinite;opacity:0}
@keyframes fbgy-score{0%,76%,90%,100%{opacity:0}80%,86%{opacity:1}}`}
    >
      <Ground />
      {/* vaulting table */}
      <T x={62} y={58} s="┌────┐" />
      <T x={62} y={68} s="│    │" />
      <T x={62} y={78} s="└────┘" />
      <T x={68} y={88} s="│  │" className="opacity-70" />
      <T x={4} y={18} s="9.7" className="fbgy-score" fill="var(--primary)" />
      <g className="fbgy-bot">
        <GlyphBot
          x={32}
          legs={
            <>
              <g className="fbgy-run">
                <T x={23} y={88} s="╱ ╲" className="fbgy-legA" />
                <T x={23} y={88} s="│ ╱" className="fbgy-legB" />
              </g>
              <T x={23} y={88} s="│ │" className="fbgy-arms" />
            </>
          }
        />
        <T x={17} y={38} s="\\" className="fbgy-arms" />
        <T x={47} y={38} s="/" className="fbgy-arms" />
      </g>
    </SceneShell>
  );
}

/** Clean & jerk — bar goes up; the lockout is a negotiation. */
function WeightliftingScene() {
  return (
    <SceneShell
      css={`
.fbwl-bot{animation:fbwl-bot 7.2s ease-in-out infinite}
@keyframes fbwl-bot{
  0%,10%{transform:translateY(0)}
  18%{transform:translateY(6px)}
  32%{transform:translateY(0)}
  44%{transform:translateY(5px)}
  56%,78%{transform:translateY(0)}
  100%{transform:translateY(0)}}
.fbwl-bar{animation:fbwl-bar 7.2s ease-in-out infinite}
@keyframes fbwl-bar{
  0%,10%{transform:translateY(0)}
  18%{transform:translateY(4px)}
  32%{transform:translateY(-28px)}
  44%{transform:translateY(-22px)}
  58%{transform:translateY(-52px)}
  64%{transform:translateY(-50px) rotate(-3deg)}
  70%{transform:translateY(-52px) rotate(3deg)}
  76%,86%{transform:translateY(-52px) rotate(0)}
  94%,100%{transform:translateY(0) rotate(0)}}
.fbwl-down{animation:fbwl-down 7.2s infinite}
@keyframes fbwl-down{0%,28%,92%,100%{opacity:1}32%,88%{opacity:0}}
.fbwl-chest{animation:fbwl-chest 7.2s infinite;opacity:0}
@keyframes fbwl-chest{0%,30%,56%,100%{opacity:0}34%,52%{opacity:1}}
.fbwl-up{animation:fbwl-up 7.2s infinite;opacity:0}
@keyframes fbwl-up{0%,54%,90%,100%{opacity:0}58%,86%{opacity:1}}
.fbwl-strain{animation:fbwl-strain 7.2s infinite}
@keyframes fbwl-strain{0%,54%,88%,100%{opacity:1}58%,84%{opacity:0}}
.fbwl-lock{animation:fbwl-lock 7.2s infinite;opacity:0}
@keyframes fbwl-lock{0%,54%,88%,100%{opacity:0}58%,84%{opacity:1}}`}
    >
      <Ground />
      <g className="fbwl-bot">
        <GlyphBot
          x={80}
          eyes={
            <>
              <T x={71} y={50} s="o o" className="fbwl-strain" />
              <T x={71} y={50} s="^ ^" className="fbwl-lock" />
            </>
          }
        />
        {/* arms reach to the bar at each height */}
        <T x={62} y={70} s="│" className="fbwl-down" />
        <T x={62} y={80} s="│" className="fbwl-down" />
        <T x={92} y={70} s="│" className="fbwl-down" />
        <T x={92} y={80} s="│" className="fbwl-down" />
        <T x={62} y={62} s="─" className="fbwl-chest" />
        <T x={92} y={62} s="─" className="fbwl-chest" />
        <T x={62} y={50} s="│" className="fbwl-up" />
        <T x={62} y={40} s="│" className="fbwl-up" />
        <T x={92} y={50} s="│" className="fbwl-up" />
        <T x={92} y={40} s="│" className="fbwl-up" />
      </g>
      <g className="fbwl-bar" style={{ transformOrigin: "80px 88px" }}>
        {/* left bumper */}
        <T x={18} y={78} s="╭───╮" fill="var(--primary)" />
        <T x={16} y={88} s="( ● )" fill="var(--primary)" />
        <T x={18} y={96} s="╰───╯" fill="var(--primary)" />
        <T x={48} y={88} s="══" />
        <T x={62} y={88} s="o" />
        <T x={92} y={88} s="o" />
        <T x={98} y={88} s="══" />
        {/* right bumper */}
        <T x={110} y={78} s="╭───╮" fill="var(--primary)" />
        <T x={108} y={88} s="( ● )" fill="var(--primary)" />
        <T x={110} y={96} s="╰───╯" fill="var(--primary)" />
      </g>
    </SceneShell>
  );
}

/** Archery — draw, hold, release; the target flinches either way. */
function ArcheryScene() {
  return (
    <SceneShell
      css={`
.fbar-draw{animation:fbar-draw 6.4s ease-in-out infinite;transform-origin:63px 58px}
@keyframes fbar-draw{0%,8%,38%,100%{transform:rotate(0)}18%,32%{transform:rotate(-22deg)}}
.fbar-arrow{animation:fbar-arrow 6.4s linear infinite}
@keyframes fbar-arrow{
  0%,32%{transform:translate(0,0);opacity:1}
  48%{transform:translate(62px,2px);opacity:1}
  52%,100%{transform:translate(62px,2px);opacity:0}}
.fbar-hit{animation:fbar-hit 6.4s infinite}
@keyframes fbar-hit{0%,48%,58%,100%{transform:translateX(0)}50%,54%{transform:translateX(3px)}}
.fbar-bull{animation:fbar-bull 6.4s infinite;opacity:0}
@keyframes fbar-bull{0%,50%,70%,100%{opacity:0}54%,66%{opacity:1}}
.fbar-hold{animation:fbar-hold 6.4s infinite;opacity:0}
@keyframes fbar-hold{0%,16%,34%,100%{opacity:0}20%,30%{opacity:1}}`}
    >
      <Ground />
      <T x={66} y={36} s="…" className="fbar-hold" fill="var(--primary)" />
      <g className="fbar-hit">
        <T x={118} y={34} s="╭───╮" />
        <T x={118} y={44} s="│" />
        <T x={142} y={44} s="│" />
        <T x={124} y={44} s="╭─╮" className="opacity-70" />
        <T x={118} y={54} s="│" />
        <T x={142} y={54} s="│" />
        <T x={130} y={54} s="●" fill="var(--primary)" />
        <T x={118} y={64} s="│" />
        <T x={142} y={64} s="│" />
        <T x={124} y={64} s="╰─╯" className="opacity-70" />
        <T x={118} y={74} s="╰───╯" />
        <T x={130} y={84} s="│" className="opacity-50" />
        <T x={130} y={34} s="+" className="fbar-bull" fill="var(--primary)" />
      </g>
      <GlyphBot x={48} />
      <g className="fbar-draw">
        <T x={63} y={60} s="─)" />
        <T x={58} y={52} s="╮" className="opacity-70" />
        <T x={58} y={68} s="╯" className="opacity-70" />
      </g>
      <g className="fbar-arrow">
        <T x={72} y={60} s="─▶" fill="var(--primary)" />
      </g>
    </SceneShell>
  );
}

/** Fencing — en garde, lunge, a very polite touché. */
function FencingScene() {
  return (
    <SceneShell
      css={`
.fbfe-lunge{animation:fbfe-lunge 5.4s ease-in-out infinite}
@keyframes fbfe-lunge{0%,12%,28%,100%{transform:translateX(0)}16%,22%{transform:translateX(16px)}}
.fbfe-foil{animation:fbfe-foil 5.4s ease-in-out infinite;transform-origin:63px 60px}
@keyframes fbfe-foil{0%,12%,28%,100%{transform:rotate(0)}16%,22%{transform:rotate(-8deg)}}
.fbfe-foe{animation:fbfe-foe 5.4s ease-in-out infinite;transform-origin:124px 88px}
@keyframes fbfe-foe{0%,18%,36%,100%{transform:rotate(0)}22%,30%{transform:rotate(12deg) translateX(6px)}}
.fbfe-clash{animation:fbfe-clash 5.4s infinite;opacity:0}
@keyframes fbfe-clash{0%,16%,26%,100%{opacity:0}18%,24%{opacity:1}}
.fbfe-point{animation:fbfe-point 5.4s infinite;opacity:0}
@keyframes fbfe-point{0%,24%,48%,100%{opacity:0}28%,42%{opacity:1}}
.fbfe-ok{animation:fbfe-ok 5.4s infinite}
@keyframes fbfe-ok{0%,18%,40%,100%{opacity:1}22%,36%{opacity:0}}
.fbfe-win{animation:fbfe-win 5.4s infinite;opacity:0}
@keyframes fbfe-win{0%,18%,40%,100%{opacity:0}22%,36%{opacity:1}}`}
    >
      <Ground />
      <T x={4} y={18} s="TOUCHÉ" className="fbfe-point" fill="var(--primary)" />
      <g className="fbfe-lunge">
        <GlyphBot
          x={44}
          eyes={
            <>
              <T x={35} y={50} s="o o" className="fbfe-ok" />
              <T x={35} y={50} s="^ ^" className="fbfe-win" />
            </>
          }
        />
        <g className="fbfe-foil">
          <T x={59} y={60} s="─────" fill="var(--primary)" />
        </g>
      </g>
      <g className="fbfe-foe">
        <T x={112} y={40} s="╭─┴─╮" className="opacity-55" />
        <T x={112} y={50} s="│ x │" className="opacity-55" />
        <T x={112} y={60} s="├───┤" className="opacity-55" />
        <T x={112} y={70} s="│   │" className="opacity-55" />
        <T x={112} y={80} s="╰┬─┬╯" className="opacity-55" />
        <T x={118} y={88} s="╱ ╲" className="opacity-55" />
        <T x={94} y={58} s="────" className="opacity-40" />
      </g>
      <T x={88} y={52} s="✶" className="fbfe-clash" fill="var(--primary)" />
    </SceneShell>
  );
}

/** Street skate — roll, ollie, try to look composed. */
function SkateboardingScene() {
  return (
    <SceneShell
      css={`
.fbsk-road{animation:fbsk-road .4s linear infinite}
@keyframes fbsk-road{0%{transform:translateX(0)}100%{transform:translateX(-18px)}}
.fbsk-ollie{animation:fbsk-ollie 5.8s ease-in-out infinite;transform-origin:70px 92px}
@keyframes fbsk-ollie{
  0%,38%{transform:translate(0,0) rotate(0)}
  44%{transform:translate(0,3px) rotate(0)}
  50%{transform:translate(0,-18px) rotate(-12deg)}
  56%{transform:translate(0,-16px) rotate(8deg)}
  62%{transform:translate(0,0) rotate(0)}
  100%{transform:translate(0,0) rotate(0)}}
.fbsk-bob{animation:fbsk-bob .5s ease-in-out infinite}
@keyframes fbsk-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1px)}}
.fbsk-legA{animation:fbsk-legA .7s steps(1) infinite}
@keyframes fbsk-legA{0%,100%{opacity:1}50%{opacity:0}}
.fbsk-legB{animation:fbsk-legB .7s steps(1) infinite;opacity:0}
@keyframes fbsk-legB{0%,100%{opacity:0}50%{opacity:1}}
.fbsk-dust{animation:fbsk-dust 5.8s infinite;opacity:0}
@keyframes fbsk-dust{0%,60%,72%,100%{opacity:0}63%,68%{opacity:1}}`}
    >
      <g className="fbsk-road">
        <T x={-16} y={96} s={"┄ ".repeat(18)} className="opacity-35" />
      </g>
      <T x={88} y={88} s="˚ ˚" className="fbsk-dust" />
      <g className="fbsk-ollie">
        <g className="fbsk-bob">
          <GlyphBot
            x={70}
            legs={
              <>
                <T x={61} y={88} s="╱ ╲" className="fbsk-legA" />
                <T x={61} y={88} s="│ ╲" className="fbsk-legB" />
              </>
            }
          />
          <T x={49} y={58} s="╲" />
          <T x={91} y={58} s="╱" />
        </g>
        <T x={40} y={92} s="╰──────────╯" />
        <T x={46} y={96} s="o" fill="var(--primary)" />
        <T x={100} y={96} s="o" fill="var(--primary)" />
      </g>
    </SceneShell>
  );
}

/** Platform dive — bounce, pencil in, splash, gone. */
function DivingScene() {
  return (
    <SceneShell
      css={`
.fbdv-board{animation:fbdv-board 6.8s ease-in-out infinite;transform-origin:10px 62px}
@keyframes fbdv-board{0%,10%,26%,100%{transform:rotate(0)}16%{transform:rotate(8deg)}22%{transform:rotate(-4deg)}}
.fbdv-bot{animation:fbdv-bot 6.8s ease-in-out infinite}
@keyframes fbdv-bot{
  0%,10%{transform:translate(0,-30px);opacity:1}
  16%{transform:translate(2px,-42px);opacity:1}
  22%{transform:translate(0,-26px);opacity:1}
  28%{transform:translate(8px,-48px);opacity:1}
  40%{transform:translate(26px,-6px);opacity:1}
  50%{transform:translate(40px,18px);opacity:1}
  56%{transform:translate(48px,34px);opacity:1}
  60%,86%{transform:translate(50px,48px);opacity:0}
  100%{transform:translate(0,-30px);opacity:1}}
.fbdv-splash{animation:fbdv-splash 6.8s infinite;opacity:0}
@keyframes fbdv-splash{0%,54%,72%,100%{opacity:0}57%,66%{opacity:1}}
.fbdv-waterA{animation:fbdv-waterA 1.8s steps(1) infinite}
@keyframes fbdv-waterA{0%,100%{opacity:.7}50%{opacity:0}}
.fbdv-waterB{animation:fbdv-waterB 1.8s steps(1) infinite;opacity:0}
@keyframes fbdv-waterB{0%,100%{opacity:0}50%{opacity:.7}}`}
    >
      <T x={4} y={20} s="││" className="opacity-50" />
      <T x={4} y={30} s="││" className="opacity-50" />
      <T x={4} y={40} s="││" className="opacity-50" />
      <T x={4} y={50} s="││" className="opacity-50" />
      <T x={4} y={60} s="││" className="opacity-50" />
      <T x={4} y={70} s="││" className="opacity-50" />
      <T x={4} y={80} s="││" className="opacity-50" />
      <T x={4} y={88} s="└┘" className="opacity-50" />
      <g className="fbdv-board">
        <T x={10} y={62} s="────────" />
      </g>
      <T x={58} y={92} s="≈ ≈ ≈ ≈ ≈ ≈ ≈ ≈ ≈" className="fbdv-waterA" fill="var(--primary)" />
      <T x={64} y={92} s="≈ ≈ ≈ ≈ ≈ ≈ ≈ ≈" className="fbdv-waterB" fill="var(--primary)" />
      <T x={70} y={78} s="◜     ◝" className="fbdv-splash" fill="var(--primary)" />
      <T x={76} y={84} s="˚ ˚ ˚" className="fbdv-splash" />
      <T x={70} y={90} s="≈≈≈≈≈" className="fbdv-splash" fill="var(--primary)" />
      <g className="fbdv-bot">
        <GlyphBot x={36} />
      </g>
    </SceneShell>
  );
}

/** Table tennis — a tidy rally until the third ball finds the floor. */
function TableTennisScene() {
  return (
    <SceneShell
      css={`
.fbtt-arm{animation:fbtt-arm 1.6s ease-in-out infinite;transform-origin:55px 58px}
@keyframes fbtt-arm{0%,100%{transform:rotate(8deg)}50%{transform:rotate(-18deg)}}
.fbtt-ball{animation:fbtt-ball 1.6s linear infinite}
@keyframes fbtt-ball{
  0%{transform:translate(64px,54px)}
  25%{transform:translate(90px,38px)}
  50%{transform:translate(118px,54px)}
  75%{transform:translate(90px,38px)}
  100%{transform:translate(64px,54px)}}
.fbtt-foe{animation:fbtt-foe 1.6s ease-in-out infinite;transform-origin:136px 56px}
@keyframes fbtt-foe{0%,100%{transform:rotate(-10deg)}50%{transform:rotate(16deg)}}
.fbtt-drop{animation:fbtt-drop 6.4s ease-in infinite;opacity:0}
@keyframes fbtt-drop{
  0%,55%{opacity:0;transform:translateY(0)}
  62%{opacity:1;transform:translateY(0)}
  78%{opacity:1;transform:translateY(28px)}
  82%,100%{opacity:0;transform:translateY(28px)}}
.fbtt-rally{animation:fbtt-rally 6.4s infinite}
@keyframes fbtt-rally{0%,60%,100%{opacity:1}64%,96%{opacity:0}}
.fbtt-oops{animation:fbtt-oops 6.4s infinite;opacity:0}
@keyframes fbtt-oops{0%,70%,90%,100%{opacity:0}74%,86%{opacity:1}}`}
    >
      <Ground />
      {/* table + net */}
      <T x={58} y={66} s="┌───────────┐" />
      <T x={94} y={58} s="┼" fill="var(--primary)" />
      <T x={64} y={76} s="│" className="opacity-40" />
      <T x={124} y={76} s="│" className="opacity-40" />
      <T x={64} y={86} s="│" className="opacity-40" />
      <T x={124} y={86} s="│" className="opacity-40" />
      <GlyphBot x={40} />
      <g className="fbtt-arm">
        <T x={55} y={60} s="─" />
        <T x={61} y={58} s="D" fill="var(--primary)" />
      </g>
      <g className="fbtt-foe">
        <T x={130} y={40} s="╭┴╮" className="opacity-50" />
        <T x={130} y={50} s="│x│" className="opacity-50" />
        <T x={130} y={60} s="╰─╯" className="opacity-50" />
        <T x={124} y={56} s="C" fill="var(--primary)" />
      </g>
      <g className="fbtt-rally">
        <T x={0} y={0} s="o" className="fbtt-ball" />
      </g>
      <T x={96} y={60} s="o" className="fbtt-drop" fill="var(--primary)" />
      <T x={66} y={38} s="!" className="fbtt-oops" fill="var(--primary)" />
    </SceneShell>
  );
}

const SCENES: Record<RobotSceneVariant, () => React.JSX.Element> = {
  sprint: SprintScene,
  swimming: SwimmingScene,
  gymnastics: GymnasticsScene,
  weightlifting: WeightliftingScene,
  archery: ArcheryScene,
  fencing: FencingScene,
  skateboarding: SkateboardingScene,
  diving: DivingScene,
  tabletennis: TableTennisScene,
};

const SCENE_LABELS: Record<RobotSceneVariant, string> = {
  sprint: "100m sprint",
  swimming: "Freestyle",
  gymnastics: "Vault",
  weightlifting: "Clean & jerk",
  archery: "Archery",
  fencing: "Fencing",
  skateboarding: "Skateboarding",
  diving: "10m platform",
  tabletennis: "Table tennis",
};

type RobotEmptyStateProps = {
  /** Pin a sport. Omit to pick one at random and rotate through the rest. */
  variant?: RobotSceneVariant;
  caption: string;
  className?: string;
};

/** Dev/preview grid of every Olympic scene playing at once. */
export function RobotSceneGallery({ className }: { className?: string }) {
  return (
    <div className={cn("grid gap-8 sm:grid-cols-2", className)}>
      {ROBOT_SCENE_VARIANTS.map((variant) => {
        const Scene = SCENES[variant];
        return (
          <div key={variant} className="text-muted-foreground flex flex-col items-center gap-1 select-none">
            <Scene />
            <p className="text-xs tracking-wide uppercase">{SCENE_LABELS[variant]}</p>
          </div>
        );
      })}
    </div>
  );
}

/** Animated glyph-robot scene shown when a list has nothing in it. */
export function RobotEmptyState({ variant, caption, className }: RobotEmptyStateProps) {
  const [picked, setPicked] = useState<RobotSceneVariant>(() => variant ?? pickRandomScene());

  useEffect(() => {
    if (variant) {
      setPicked(variant);
      return;
    }
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) return;
    const id = window.setInterval(() => {
      setPicked((current) => pickRandomScene(current));
    }, SCENE_MS);
    return () => window.clearInterval(id);
  }, [variant]);

  const Scene = SCENES[picked];
  return (
    <div className={cn("text-muted-foreground flex flex-col items-center gap-2 py-6 select-none", className)}>
      <div key={picked} className="animate-fade-up">
        <Scene />
      </div>
      <p className="text-sm">{caption}</p>
    </div>
  );
}

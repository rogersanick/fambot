import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Fambot empty-state scenes: the robot earnestly attempts human hobbies
 * (painting, boxing, juggling, hiking, fishing) and fumbles them a little.
 *
 * Styled like ASCII art — every shape is a monospace glyph on a 6px column
 * grid — but rendered as SVG so motion is smooth. Animation is strictly rigid
 * (translate/rotate) plus opacity frame-swaps: nothing stretches or resizes.
 * Colors follow currentColor with sparse var(--primary) accents; everything
 * pauses under prefers-reduced-motion.
 */

export type RobotSceneVariant = "painting" | "boxing" | "juggling" | "hiking" | "fishing";

const MONO = 'var(--font-mono, "Fira Code", ui-monospace, monospace)';

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

/** Painting a self-portrait; a drip runs off the canvas mid-masterpiece. */
function PaintingScene() {
  return (
    <svg viewBox="0 0 160 100" width="190" className="fb-scene" aria-hidden>
      <style>{`${SHARED_CSS}
.fbp-arm{animation:fbp-arm 7s ease-in-out infinite;transform-origin:63px 58px}
@keyframes fbp-arm{0%,4%,12%,20%,70%,78%,100%{transform:rotate(0)}8%,16%,74%{transform:rotate(-14deg)}}
.fbp-eyes{animation:fbp-eyes 7s infinite;opacity:0}
@keyframes fbp-eyes{0%,9%{opacity:0}11%,100%{opacity:1}}
.fbp-smile{animation:fbp-smile 7s infinite;opacity:0}
@keyframes fbp-smile{0%,17%{opacity:0}19%,100%{opacity:1}}
.fbp-drip{animation:fbp-drip 7s linear infinite;opacity:0}
@keyframes fbp-drip{0%,30%{opacity:0;transform:translateY(0)}33%{opacity:1}44%{opacity:1;transform:translateY(26px)}46%,100%{opacity:0;transform:translateY(26px)}}
.fbp-splat{animation:fbp-splat 7s infinite;opacity:0}
@keyframes fbp-splat{0%,44%,97%,100%{opacity:0}47%,92%{opacity:1}}
.fbp-oops{animation:fbp-oops 7s infinite;opacity:0}
@keyframes fbp-oops{0%,48%,68%,100%{opacity:0}52%,64%{opacity:1}}`}</style>
      <Ground />
      {/* easel + canvas */}
      <T x={100} y={34} s="┌─────┐" />
      <T x={100} y={44} s="│" />
      <T x={136} y={44} s="│" />
      <T x={100} y={54} s="│" />
      <T x={136} y={54} s="│" />
      <T x={100} y={64} s="└─────┘" />
      <T x={103} y={76} s="╱" />
      <T x={133} y={76} s="╲" />
      <T x={100} y={88} s="╱" />
      <T x={136} y={88} s="╲" />
      {/* the portrait, painted stroke by stroke */}
      <T x={109} y={46} s="o o" className="fbp-eyes" fill="var(--primary)" />
      <T x={112} y={55} s="‿" className="fbp-smile" fill="var(--primary)" />
      {/* the runaway drip */}
      <T x={106} y={60} s="," className="fbp-drip" fill="var(--primary)" />
      <T x={104} y={90} s="꞉" className="fbp-splat" fill="var(--primary)" />
      <T x={66} y={38} s="!" className="fbp-oops" fill="var(--primary)" />
      <GlyphBot x={48} />
      {/* brush arm */}
      <g className="fbp-arm">
        <T x={63} y={62} s="─╱" />
        <T x={75} y={54} s="·" fill="var(--primary)" />
      </g>
    </svg>
  );
}

/** One good jab — then the bag swings back and bonks him. */
function BoxingScene() {
  return (
    <svg viewBox="0 0 160 100" width="190" className="fb-scene" aria-hidden>
      <style>{`${SHARED_CSS}
.fbb-bag{animation:fbb-bag 5.6s ease-in-out infinite;transform-origin:121px 12px}
@keyframes fbb-bag{0%,12%{transform:rotate(0)}20%{transform:rotate(18deg)}32%{transform:rotate(-13deg)}42%{transform:rotate(7deg)}52%,100%{transform:rotate(0)}}
.fbb-jab{animation:fbb-jab 5.6s ease-in-out infinite}
@keyframes fbb-jab{0%,10%,22%,100%{transform:translateX(0)}14%,17%{transform:translateX(9px)}}
.fbb-bot{animation:fbb-bot 5.6s ease-in-out infinite;transform-origin:44px 88px}
@keyframes fbb-bot{0%,29%,54%,100%{transform:translateX(0) rotate(0)}33%,44%{transform:translateX(-6px) rotate(-7deg)}}
.fbb-ok{animation:fbb-ok 5.6s infinite}
@keyframes fbb-ok{0%,31%,57%,100%{opacity:1}33%,55%{opacity:0}}
.fbb-ko{animation:fbb-ko 5.6s infinite;opacity:0}
@keyframes fbb-ko{0%,31%,57%,100%{opacity:0}33%,55%{opacity:1}}
.fbb-stars{animation:fbb-stars 5.6s infinite;opacity:0}
@keyframes fbb-stars{0%,32%,58%,100%{opacity:0}36%,52%{opacity:1}}`}</style>
      <Ground />
      {/* mount + bag */}
      <T x={100} y={10} s="─────────" className="opacity-40" />
      <g className="fbb-bag">
        <T x={118} y={18} s="╥" />
        <T x={112} y={28} s="▐█▌" />
        <T x={112} y={38} s="▐█▌" />
        <T x={112} y={48} s="▐█▌" />
      </g>
      <g className="fbb-bot">
        <GlyphBot
          x={44}
          eyes={
            <>
              <T x={35} y={50} s="o o" className="fbb-ok" />
              <T x={35} y={50} s="x x" className="fbb-ko" />
            </>
          }
        />
        {/* rear guard glove */}
        <T x={23} y={56} s="O" fill="var(--primary)" />
        {/* jab glove */}
        <g className="fbb-jab">
          <T x={59} y={60} s="──" />
          <T x={71} y={60} s="O" fill="var(--primary)" />
        </g>
        <T x={38} y={26} s="✶ ✶" className="fbb-stars" fill="var(--primary)" />
      </g>
    </svg>
  );
}

/** A tidy two-ball cascade… because the third one got away. */
function JugglingScene() {
  return (
    <svg viewBox="0 0 160 100" width="190" className="fb-scene" aria-hidden>
      <style>{`${SHARED_CSS}
.fbj-a{animation:fbj-path 2.4s linear infinite}
.fbj-b{animation:fbj-path 2.4s linear infinite;animation-delay:-1.2s}
@keyframes fbj-path{
  0%{transform:translate(37px,52px)}
  15%{transform:translate(46px,26px)}
  30%{transform:translate(60px,18px)}
  45%{transform:translate(74px,26px)}
  60%{transform:translate(83px,52px)}
  80%{transform:translate(60px,62px)}
  100%{transform:translate(37px,52px)}}
.fbj-armL{animation:fbj-armL 1.2s ease-in-out infinite;transform-origin:45px 58px}
@keyframes fbj-armL{0%,100%{transform:rotate(0)}50%{transform:rotate(-14deg)}}
.fbj-armR{animation:fbj-armR 1.2s ease-in-out infinite;transform-origin:75px 58px}
@keyframes fbj-armR{0%,100%{transform:rotate(14deg)}50%{transform:rotate(0)}}
.fbj-shame{animation:fbj-shame 4.8s infinite;opacity:0}
@keyframes fbj-shame{0%,45%,70%,100%{opacity:0}50%,65%{opacity:1}}`}</style>
      <Ground />
      <GlyphBot x={60} />
      {/* raised forearms */}
      <g className="fbj-armL">
        <T x={39} y={58} s="╲" />
      </g>
      <g className="fbj-armR">
        <T x={75} y={58} s="╱" />
      </g>
      {/* two loyal balls (drawn at origin, flown by keyframes) */}
      <T x={0} y={0} s="o" className="fbj-a" />
      <T x={0} y={0} s="o" className="fbj-b" />
      {/* the deserter */}
      <T x={104} y={88} s="●" fill="var(--primary)" />
      <T x={98} y={78} s="!" className="fbj-shame" fill="var(--primary)" />
    </svg>
  );
}

/** Hiking at a steady clip — until a rock wanders under his foot. */
function HikingScene() {
  return (
    <svg viewBox="0 0 160 100" width="190" className="fb-scene" aria-hidden>
      <style>{`${SHARED_CSS}
.fbh-bob{animation:fbh-bob 0.9s ease-in-out infinite}
@keyframes fbh-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
.fbh-trip{animation:fbh-trip 6s ease-in-out infinite;transform-origin:46px 88px}
@keyframes fbh-trip{0%,80%,94%,100%{transform:rotate(0)}84%,88%{transform:rotate(16deg)}}
.fbh-legA{animation:fbh-legA 0.9s steps(1) infinite}
@keyframes fbh-legA{0%,100%{opacity:1}50%{opacity:0}}
.fbh-legB{animation:fbh-legB 0.9s steps(1) infinite;opacity:0}
@keyframes fbh-legB{0%,100%{opacity:0}50%{opacity:1}}
.fbh-stick{animation:fbh-stick 0.9s ease-in-out infinite;transform-origin:61px 58px}
@keyframes fbh-stick{0%,100%{transform:rotate(0)}50%{transform:rotate(7deg)}}
.fbh-trail{animation:fbh-trail 0.9s linear infinite}
@keyframes fbh-trail{0%{transform:translateX(0)}100%{transform:translateX(-18px)}}
.fbh-rock{animation:fbh-rock 6s linear infinite}
@keyframes fbh-rock{0%{transform:translateX(0);opacity:0}6%{opacity:1}76%{opacity:1}82%,100%{transform:translateX(-120px);opacity:0}}
.fbh-oops{animation:fbh-oops 6s infinite;opacity:0}
@keyframes fbh-oops{0%,82%,96%,100%{opacity:0}86%,93%{opacity:1}}`}</style>
      {/* sun + a modest summit */}
      <T x={136} y={18} s="☼" fill="var(--primary)" />
      <T x={117} y={46} s="⌐" fill="var(--primary)" />
      <T x={114} y={54} s="╱╲" className="opacity-60" />
      <T x={108} y={64} s="╱  ╲" className="opacity-60" />
      <T x={102} y={74} s="╱    ╲" className="opacity-60" />
      <T x={96} y={84} s="╱      ╲" className="opacity-60" />
      {/* scrolling trail */}
      <g className="fbh-trail">
        <T x={-14} y={92} s={"┄  ".repeat(12)} className="opacity-40" />
      </g>
      <g className="fbh-rock">
        <T x={150} y={90} s="▴" fill="var(--primary)" />
      </g>
      <T x={64} y={34} s="!" className="fbh-oops" fill="var(--primary)" />
      <g className="fbh-trip">
        <g className="fbh-bob">
          <GlyphBot
            x={46}
            legs={
              <>
                <T x={37} y={88} s="╱ ╲" className="fbh-legA" />
                <T x={37} y={88} s="│ │" className="fbh-legB" />
              </>
            }
          />
          {/* trekking pole */}
          <g className="fbh-stick">
            <T x={61} y={62} s="─╲" />
            <T x={70} y={74} s="│" />
            <T x={70} y={86} s="│" />
          </g>
        </g>
      </g>
    </svg>
  );
}

/** Patient fishing — the fish are jumping everywhere except his line. */
function FishingScene() {
  return (
    <svg viewBox="0 0 160 100" width="190" className="fb-scene" aria-hidden>
      <style>{`${SHARED_CSS}
.fbf-bobber{animation:fbf-bobber 2.6s ease-in-out infinite}
@keyframes fbf-bobber{0%,100%{transform:translateY(0)}50%{transform:translateY(2px)}}
.fbf-waterA{animation:fbf-waterA 2.6s steps(1) infinite}
@keyframes fbf-waterA{0%,100%{opacity:.7}50%{opacity:0}}
.fbf-waterB{animation:fbf-waterB 2.6s steps(1) infinite;opacity:0}
@keyframes fbf-waterB{0%,100%{opacity:0}50%{opacity:.7}}
.fbf-fish{animation:fbf-fish 7s ease-in-out infinite;opacity:0;transform-origin:137px 83px}
@keyframes fbf-fish{
  0%,50%{opacity:0;transform:translate(0,0) rotate(0)}
  53%{opacity:1;transform:translate(-8px,-14px) rotate(-24deg)}
  57%{opacity:1;transform:translate(-18px,-22px) rotate(-38deg)}
  61%{opacity:1;transform:translate(-30px,-10px) rotate(-64deg)}
  64%,100%{opacity:0;transform:translate(-36px,2px) rotate(-72deg)}}
.fbf-splash{animation:fbf-splash 7s infinite;opacity:0}
@keyframes fbf-splash{0%,60%,72%,100%{opacity:0}63%,69%{opacity:1}}
.fbf-huh{animation:fbf-huh 7s infinite;opacity:0}
@keyframes fbf-huh{0%,64%,86%,100%{opacity:0}68%,82%{opacity:1}}`}</style>
      {/* shore under the robot, water to the right */}
      <T x={4} y={92} s={"─".repeat(11)} className="opacity-40" />
      <T x={64} y={92} s="≈ ≈ ≈ ≈ ≈ ≈ ≈ ≈" className="fbf-waterA" fill="var(--primary)" />
      <T x={70} y={92} s="≈ ≈ ≈ ≈ ≈ ≈ ≈" className="fbf-waterB" fill="var(--primary)" />
      <GlyphBot x={36} />
      {/* rod + line + bobber */}
      <T x={51} y={62} s="─" />
      <T x={57} y={58} s="╱" />
      <T x={63} y={50} s="╱" />
      <T x={69} y={60} s="┆" />
      <T x={69} y={70} s="┆" />
      <T x={69} y={80} s="┆" />
      <g className="fbf-bobber">
        <T x={69} y={90} s="o" fill="var(--primary)" />
      </g>
      {/* the show-off fish */}
      <g className="fbf-fish">
        <T x={128} y={86} s="<><" />
      </g>
      <T x={92} y={88} s="∙ ∙" className="fbf-splash" />
      <T x={54} y={38} s="?" className="fbf-huh" fill="var(--primary)" />
    </svg>
  );
}

const SCENES: Record<RobotSceneVariant, () => React.JSX.Element> = {
  painting: PaintingScene,
  boxing: BoxingScene,
  juggling: JugglingScene,
  hiking: HikingScene,
  fishing: FishingScene,
};

type RobotEmptyStateProps = {
  variant: RobotSceneVariant;
  caption: string;
  className?: string;
};

/** Animated glyph-robot scene shown when a list has nothing in it. */
export function RobotEmptyState({ variant, caption, className }: RobotEmptyStateProps) {
  const Scene = SCENES[variant];
  return (
    <div className={cn("text-muted-foreground flex flex-col items-center gap-2 py-6 select-none", className)}>
      <Scene />
      <p className="text-sm">{caption}</p>
    </div>
  );
}

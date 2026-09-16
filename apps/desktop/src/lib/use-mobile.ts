import { useEffect, useState } from "react";

/** Tailwind `md` — below this we use iPhone chrome (bottom bar, sheets). */
export const MOBILE_BREAKPOINT = 768;
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(MOBILE_QUERY).matches
  );

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(media.matches);
    media.addEventListener("change", onChange);
    onChange();
    return () => media.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

/**
 * How many CSS pixels the software keyboard covers, via visualViewport.
 * Applied as bottom inset so composers stay above the iOS keyboard.
 */
export function useKeyboardOffset() {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const sync = () => {
      const covered = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setOffset(covered);
    };

    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);
    sync();
    return () => {
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
    };
  }, []);

  return offset;
}

import { useEffect, useState } from "react";

/**
 * Tracks whether a CSS media query currently matches, updating live as the
 * viewport changes (resize, orientation change, or a devtools breakpoint
 * toggle) - backed by `window.matchMedia`'s own change event, not a resize
 * listener/poll. Works for any valid media query, not just width breakpoints
 * - e.g. `useMediaQuery("(prefers-reduced-motion: reduce)")`.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mediaQueryList = window.matchMedia(query);
    const handleChange = () => setMatches(mediaQueryList.matches);
    handleChange();
    mediaQueryList.addEventListener("change", handleChange);
    return () => mediaQueryList.removeEventListener("change", handleChange);
  }, [query]);

  return matches;
}

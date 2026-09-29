import { useEffect, useState } from "react";

// Deliberately narrow (480px, not a more common ~640px breakpoint): a tablet
// held in portrait is easily 600-800px wide, and the goal is "a tablet always
// gets the desktop grid regardless of orientation, only true phone widths get
// the card view" -- see the mobile-view plan.
export function useIsNarrowViewport(maxWidthPx = 480): boolean {
  const query = `(max-width: ${maxWidthPx}px)`;
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handleChange = () => setIsNarrow(mql.matches);
    handleChange();
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, [query]);

  return isNarrow;
}

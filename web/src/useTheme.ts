import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "theme";

function readStored(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

// "system" removes the attribute entirely rather than setting it to some
// third value -- styles.css's dark-mode block is already scoped to
// `:root:not([data-theme="light"])` under prefers-color-scheme, so no
// attribute at all is exactly what lets that media query decide. The
// synchronous inline script in index.html applies the same stored choice
// before first paint (duplicated there, not imported, since it has to run
// before any module script) -- this hook is what keeps it in sync after
// that, including a toggle mid-session.
function applyTheme(theme: Theme) {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(readStored);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    try {
      if (t === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // Private browsing / storage disabled -- the choice just won't
      // survive a reload, same degradation every other localStorage use in
      // this app already accepts.
    }
  };

  return [theme, setTheme];
}

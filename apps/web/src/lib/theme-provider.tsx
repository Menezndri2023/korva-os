"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "korva-theme";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // "light" matches what the server rendered (it can't know the visitor's stored preference or
  // OS setting) — this only ever mismatches the real, already-visible theme for a single frame
  // of the toggle button's icon, never the page itself: the no-flash inline script in
  // layout.tsx already set the correct data-theme attribute (and so the correct colors)
  // synchronously before this component ever mounted.
  const [theme, setTheme] = useState<Theme>("light");

  // Reads the DOM attribute the no-flash inline script (layout.tsx) already set — the standard
  // React pattern for syncing from a browser-only external source, which unavoidably means a
  // one-time setState once the real value is known (same rationale as the storefront's own
  // useCart/useCustomerAuth hydration effects). Deliberately not moved to render-time
  // (e.g. useState(() => ...)): that would read the DOM during the server render too, where it
  // doesn't exist, and desync from the client's real value — a hydration mismatch on the toggle
  // button's icon. Never *writes* the attribute here, only reads it, so this can never race the
  // inline script.
  /* eslint-disable react-hooks/set-state-in-effect -- see comment above */
  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme") as Theme | null;
    setTheme(current ?? getSystemTheme());
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  function toggleTheme() {
    setTheme((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      window.localStorage.setItem(STORAGE_KEY, next);
      document.documentElement.setAttribute("data-theme", next);
      return next;
    });
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}

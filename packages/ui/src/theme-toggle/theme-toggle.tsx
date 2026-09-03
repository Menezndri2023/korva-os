import { Button } from "../button/button.tsx";

export interface ThemeToggleProps {
  theme: "light" | "dark";
  onToggle: () => void;
}

/** Purely presentational, like every other packages/ui component — the actual theme state,
 *  persistence, and DOM attribute writes live in the consuming app (apps/web's ThemeProvider),
 *  since a design-system component never owns application state. */
export function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={theme === "dark" ? "Passer au thème clair" : "Passer au thème sombre"}
      onClick={onToggle}
      className="p-2"
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10 1.5v2M10 16.5v2M18.5 10h-2M3.5 10h-2M15.66 4.34l-1.42 1.42M5.76 14.24l-1.42 1.42M15.66 15.66l-1.42-1.42M5.76 5.76L4.34 4.34"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M17 11.5A7 7 0 118.5 3a5.5 5.5 0 108.5 8.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

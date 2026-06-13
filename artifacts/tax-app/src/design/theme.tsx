/**
 * UX 2.0 (T2.3 D1/D7) — theme provider + toggle.
 *
 * The Brookhaven dark token set already lives in index.css under `.dark`; this
 * wires the runtime switch: light / dark / system, persisted to localStorage,
 * applied to <html> as the `.dark` class, and live-following the OS when in
 * "system" mode. A tiny pre-paint script in index.html sets the class before
 * first paint to avoid a flash (see applyTheme/THEME_BOOT).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export type Theme = "light" | "dark" | "system";
const STORAGE_KEY = "taxflow-theme";

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

/** Resolve a theme choice to the concrete mode and apply it to <html>. */
function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const dark = theme === "dark" || (theme === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

function readStored(): Theme {
  if (typeof localStorage === "undefined") return "system";
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** The concrete mode currently rendered. */
  resolved: "light" | "dark";
}
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStored);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try { localStorage.setItem(STORAGE_KEY, t); } catch { /* private mode */ }
    applyTheme(t);
  }, []);

  // Apply on mount and whenever the choice changes.
  useEffect(() => { applyTheme(theme); }, [theme]);

  // When in "system" mode, follow live OS changes.
  useEffect(() => {
    if (theme !== "system" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, resolved: (theme === "dark" || (theme === "system" && systemPrefersDark())) ? "dark" : "light" }),
    [theme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

const ORDER: Theme[] = ["light", "dark", "system"];
const META: Record<Theme, { icon: typeof Sun; label: string }> = {
  light: { icon: Sun, label: "Light" },
  dark: { icon: Moon, label: "Dark" },
  system: { icon: Monitor, label: "System" },
};

/** Cycles light → dark → system. Icon + accessible label reflect the choice. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const { icon: Icon, label } = META[theme];
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      onClick={() => setTheme(next)}
      aria-label={`Theme: ${label}. Switch to ${META[next].label}.`}
      title={`Theme: ${label} — click for ${META[next].label}`}
    >
      <Icon className="h-4 w-4" strokeWidth={2} />
    </Button>
  );
}

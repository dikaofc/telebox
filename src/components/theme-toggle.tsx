"use client";

import { useEffect, useCallback, useSyncExternalStore } from "react";
import { IconSun, IconMoon } from "@/components/icons";

/**
 * Theme is an external store (localStorage + prefers-color-scheme) read
 * through useSyncExternalStore: the server snapshot is neutral so hydration
 * never mismatches, and the real value is adopted right after hydration —
 * no setState-in-effect and no flash-of-wrong-theme error.
 */
type Theme = "light" | "dark";

const listeners = new Set<() => void>();
let cachedTheme: Theme | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Theme {
  if (cachedTheme === null) {
    const stored = localStorage.getItem("theme") as Theme | null;
    cachedTheme =
      stored ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }
  return cachedTheme;
}

function getServerSnapshot(): Theme {
  return "light";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Keep the document attribute in sync whenever the store value changes.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const toggle = useCallback(() => {
    const next: Theme = getSnapshot() === "light" ? "dark" : "light";
    cachedTheme = next;
    localStorage.setItem("theme", next);
    document.documentElement.setAttribute("data-theme", next);
    for (const listener of listeners) listener();
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      className="nav-btn"
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
      style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
    >
      {theme === "light" ? <IconMoon size={14} /> : <IconSun size={14} />}
    </button>
  );
}

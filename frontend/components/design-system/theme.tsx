"use client";

import { createContext, useContext, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { MotionConfig } from "motion/react";

export type LuminousTheme = "light" | "dark";
export const LuminousThemeContext = createContext<LuminousTheme | null>(null);
export const useLuminousTheme = () => useContext(LuminousThemeContext);
const ThemeActionsContext = createContext<{ theme: LuminousTheme; toggleTheme: () => void } | null>(null);

const systemThemeQuery = "(prefers-color-scheme: dark)";
const getSystemTheme = (): LuminousTheme => window.matchMedia(systemThemeQuery).matches ? "dark" : "light";
// Keep server markup and the first hydration render identical. The head script
// already colors the document while React resolves the browser preference.
const getServerTheme = () => null;
function subscribeToSystemTheme(onChange: () => void) {
  const query = window.matchMedia(systemThemeQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** The document boundary includes body portals and survives role-layout navigation. */
export function ApplicationThemeProvider({ children }: { children: ReactNode }) {
  const systemTheme = useSyncExternalStore(subscribeToSystemTheme, getSystemTheme, getServerTheme);
  const [manualTheme, setManualTheme] = useState<LuminousTheme | null>(null);
  const theme = manualTheme ?? systemTheme ?? "light";
  const pathname = usePathname();
  const workspace = /^\/audit(?:\/|$)/.test(pathname) ? "auditor"
    : /^\/admin(?:\/|$)/.test(pathname) ? "admin" : "customer";
  // Keep body portals in the same palette, and reset it when leaving a role route.
  // This is presentation only; account authorization remains in RoleGuard.
  useLayoutEffect(() => {
    document.documentElement.dataset.workspace = workspace;
  }, [workspace]);
  useLayoutEffect(() => {
    // Never replace the pre-paint preference with the server's light fallback.
    if (systemTheme === null && manualTheme === null) return;
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.classList.toggle("dark", theme === "dark");
  }, [theme, systemTheme, manualTheme]);
  // This override lives only as long as the root provider: client navigation
  // keeps it, and a full reload follows the browser again.
  const actions = useMemo(() => ({ theme, toggleTheme: () => setManualTheme(theme === "light" ? "dark" : "light") }), [theme]);
  return <ThemeActionsContext.Provider value={actions}>
    <LuminousThemeContext.Provider value={theme}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LuminousThemeContext.Provider>
  </ThemeActionsContext.Provider>;
}

export function useApplicationTheme() {
  const context = useContext(ThemeActionsContext);
  if (!context) throw new Error("Application theme requires ApplicationThemeProvider");
  return context;
}

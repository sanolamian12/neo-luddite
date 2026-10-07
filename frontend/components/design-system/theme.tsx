"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { MotionConfig } from "motion/react";

export type LuminousTheme = "light" | "dark";
export const LuminousThemeContext = createContext<LuminousTheme | null>(null);
export const useLuminousTheme = () => useContext(LuminousThemeContext);
const ThemeActionsContext = createContext<{ theme: LuminousTheme; toggleTheme: () => void } | null>(null);

/** The document boundary includes body portals and survives role-layout navigation. */
export function ApplicationThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<LuminousTheme>("light");
  const pathname = usePathname();
  const workspace = /^\/audit(?:\/|$)/.test(pathname) ? "auditor"
    : /^\/admin(?:\/|$)/.test(pathname) ? "admin" : "customer";
  // Keep body portals in the same palette, and reset it when leaving a role route.
  // This is presentation only; account authorization remains in RoleGuard.
  useLayoutEffect(() => {
    document.documentElement.dataset.workspace = workspace;
  }, [workspace]);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.classList.toggle("dark", theme === "dark");
  }, [theme]);
  const actions = useMemo(() => ({ theme, toggleTheme: () => setTheme(value => value === "light" ? "dark" : "light") }), [theme]);
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

"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { MotionConfig } from "motion/react";

export type LuminousTheme = "light" | "dark";
export const LuminousThemeContext = createContext<LuminousTheme | null>(null);
export const useLuminousTheme = () => useContext(LuminousThemeContext);
const ThemeActionsContext = createContext<{ theme: LuminousTheme; toggleTheme: () => void } | null>(null);

/** The document boundary includes body portals and survives role-layout navigation. */
export function ApplicationThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<LuminousTheme>("light");
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

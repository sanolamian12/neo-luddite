"use client";

import { createContext, useContext } from "react";

export type LuminousTheme = "light" | "dark";

/** Carries an opt-in theme through portals without changing unrelated routes. */
export const LuminousThemeContext = createContext<LuminousTheme | null>(null);
export const useLuminousTheme = () => useContext(LuminousThemeContext);

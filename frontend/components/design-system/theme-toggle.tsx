"use client";

import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApplicationTheme } from "./theme";

export function ThemeToggle() {
  const { theme, toggleTheme } = useApplicationTheme();
  return <Button variant="ghost" size="icon" onClick={toggleTheme}
    aria-label={theme === "light" ? "어두운 테마로 전환" : "밝은 테마로 전환"}>
    {theme === "light" ? <Moon /> : <Sun />}
  </Button>;
}

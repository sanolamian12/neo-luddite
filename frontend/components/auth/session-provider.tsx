"use client";

import { useEffect } from "react";
import { startAccountSession } from "@/lib/account-store";

export function AccountSessionProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => startAccountSession(), []);
  return <>{children}</>;
}

"use client";

import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Shared button behavior with the luminous sizing and opaque hover treatment. */
export function LuminousButton({
  variant = "default",
  className,
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      {...props}
      variant={variant}
      data-variant={variant}
      className={cn("ds-control", className)}
    />
  );
}

import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SurfaceTone = "neutral" | "mint" | "sky" | "amber";
export type SurfaceMaterial = "solid" | "tinted" | "glass";
export type SurfaceDensity = "comfortable" | "compact";
export type StatusTone = "neutral" | "success" | "info" | "warning" | "danger";

/** Use within a .luminous theme boundary. Visual tone never implies status. */
export function Surface({
  tone = "neutral",
  material = "solid",
  density,
  className,
  ...props
}: ComponentProps<"article"> & {
  tone?: SurfaceTone;
  material?: SurfaceMaterial;
  density?: SurfaceDensity;
}) {
  return (
    <article
      className={cn("ds-surface", className)}
      data-tone={tone}
      data-material={material}
      data-density={density}
      {...props}
    />
  );
}

export function StatusBadge({
  tone = "neutral",
  children,
}: {
  tone?: StatusTone;
  children: ReactNode;
}) {
  return (
    <span className="ds-status" data-status={tone}>
      <span aria-hidden="true" />
      {children}
    </span>
  );
}

export function CardHeading({
  title,
  detail,
}: {
  title: string;
  detail?: ReactNode;
}) {
  return (
    <div className="ds-card-heading">
      <h3>{title}</h3>
      {detail}
    </div>
  );
}

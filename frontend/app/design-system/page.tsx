import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DesignSystemSpecimen } from "@/components/design-system/specimen";
import { isPrototype } from "@/lib/data-mode";

export const metadata: Metadata = {
  title: "디자인 시스템 · Neo-Luddite",
  robots: { index: false, follow: false },
};

export default function DesignSystemPage() {
  if (!isPrototype) notFound();
  return <DesignSystemSpecimen />;
}

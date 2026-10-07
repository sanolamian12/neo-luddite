import { notFound } from "next/navigation";
import { isPrototype } from "@/lib/data-mode";
import { DemoLauncher } from "@/components/demo/launcher";
export default function DemoPage() { if (!isPrototype) notFound(); return <DemoLauncher />; }

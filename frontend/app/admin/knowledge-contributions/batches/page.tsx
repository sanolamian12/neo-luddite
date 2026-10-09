import { notFound } from "next/navigation";
import { isPrototype } from "@/lib/data-mode";
import { DemoBatches } from "@/components/demo/batches";
export default function BatchesPage() { if (!isPrototype) notFound(); return <DemoBatches />; }

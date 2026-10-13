import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isPrototype } from "@/lib/data-mode";
import { AnswerTableExamples } from "@/components/chat/answer-table-examples";

export const metadata: Metadata = { title: "답변 표 미리보기 — 세무상담", robots: { index: false, follow: false } };
export default function AnswerTablesPage() {
  if (!isPrototype) notFound();
  return <AnswerTableExamples />;
}

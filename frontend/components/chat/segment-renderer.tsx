"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import type { Message, Segment } from "@/lib/conversation-schema";
import { AnswerMarkdown } from "./answer-markdown";
import { Badge } from "@/components/ui/badge";
import { ANSWER_DISPLAY, isHeadingSegment, isStatuteCitation } from "@/lib/answer-display";

/** 법령 접기 — 답에 나온 조문 배지를 한 번씩 모아 답 끝 접기 하나로(ANSWER_DISPLAY.lawFold). */
function LawFold({ segments }: { segments: Segment[] }) {
  const laws = [...new Set(segments.flatMap((s) => s.citations ?? []).filter(isStatuteCitation))];
  if (!laws.length) return null;
  return (
    <details className="answer-law-fold text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none">근거 법령 {laws.length}개</summary>
      <ul className="mt-1.5 flex flex-wrap gap-1">
        {laws.map((c) => (
          <li key={c}><Badge variant="outline" className="text-[10px] font-normal">{c}</Badge></li>
        ))}
      </ul>
    </details>
  );
}

/**
 * 세그먼트(문장) 단위 렌더러.
 * 각 세그먼트를 data-segment-id로 DOM에 노출 → 후속 주석 프로토타입의 앵커링 키.
 * assistant 메시지는 progressive=true로 추론이 한 문장씩 펼쳐지는 효과.
 */

function SegmentView({ seg, markdown, foldLaws }: { seg: Segment; markdown: boolean; foldLaws: boolean }) {
  // 법령 접기(ANSWER_DISPLAY.lawFold)면 조문 배지는 답 끝 접기로 옮기고, 문서번호 배지만 문장 옆에 남긴다.
  const citations = foldLaws ? seg.citations?.filter((c) => !isStatuteCitation(c)) : seg.citations;
  const hasMeta = Boolean(seg.framework || citations?.length);
  const summary = seg.type === "summary" && ANSWER_DISPLAY.emphasizeSummary;
  const heading = ANSWER_DISPLAY.boldHeadings && isHeadingSegment(seg.text);
  return (
    <motion.div
      data-segment-id={seg.id}
      data-segment-type={seg.type}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={summary
        ? "answer-summary min-w-0 text-[1.06em] font-semibold leading-relaxed"
        : heading ? "answer-heading min-w-0 pt-1 font-semibold leading-relaxed" : "min-w-0 leading-relaxed"}
    >
      {markdown ? <AnswerMarkdown text={seg.text} /> : <span className="whitespace-pre-wrap">{seg.text}</span>}
      {hasMeta && (
        <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
          {seg.framework && (
            <Badge variant="secondary" className="text-[10px] font-normal">
              {seg.framework}
            </Badge>
          )}
          {citations?.map((c) => (
            <Badge key={c} variant="outline" className="text-[10px] font-normal">
              {c}
            </Badge>
          ))}
        </span>
      )}
    </motion.div>
  );
}

function MessageSegments({
  message,
  progressive = false,
}: {
  message: Message;
  progressive?: boolean;
}) {
  const total = message.segments.length;
  const [count, setCount] = useState(progressive ? 0 : total);

  useEffect(() => {
    if (!progressive) return;
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setCount(i);
      if (i >= total) clearInterval(t);
    }, 450);
    return () => clearInterval(t);
  }, [message.id, total, progressive]);

  const assistant = message.role === "assistant";
  const foldLaws = assistant && ANSWER_DISPLAY.lawFold;
  const shown = message.segments.slice(0, progressive ? count : total);
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-2" data-message-id={message.id}>
      {shown.map((seg) => (
        <SegmentView key={seg.id} seg={seg} markdown={assistant} foldLaws={foldLaws} />
      ))}
      {foldLaws && shown.length === total && <LawFold segments={message.segments} />}
    </div>
  );
}

export function SegmentRenderer({ message, progressive = false }: { message: Message; progressive?: boolean }) {
  return <MessageSegments key={`${message.id}:${progressive}`} message={message} progressive={progressive} />;
}

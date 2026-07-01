"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import type { Message, Segment } from "@/lib/conversation-schema";
import { Badge } from "@/components/ui/badge";

/**
 * 세그먼트(문장) 단위 렌더러.
 * 각 세그먼트를 data-segment-id로 DOM에 노출 → 후속 주석 프로토타입의 앵커링 키.
 * assistant 메시지는 progressive=true로 추론이 한 문장씩 펼쳐지는 효과.
 */

function SegmentView({ seg }: { seg: Segment }) {
  const hasMeta = Boolean(seg.framework || seg.citations?.length);
  return (
    <motion.p
      data-segment-id={seg.id}
      data-segment-type={seg.type}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="leading-relaxed"
    >
      <span>{seg.text}</span>
      {hasMeta && (
        <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
          {seg.framework && (
            <Badge variant="secondary" className="text-[10px] font-normal">
              {seg.framework}
            </Badge>
          )}
          {seg.citations?.map((c) => (
            <Badge key={c} variant="outline" className="text-[10px] font-normal">
              {c}
            </Badge>
          ))}
        </span>
      )}
    </motion.p>
  );
}

export function SegmentRenderer({
  message,
  progressive = false,
}: {
  message: Message;
  progressive?: boolean;
}) {
  const total = message.segments.length;
  const [count, setCount] = useState(progressive ? 0 : total);

  useEffect(() => {
    if (!progressive) {
      setCount(total);
      return;
    }
    setCount(0);
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setCount(i);
      if (i >= total) clearInterval(t);
    }, 450);
    return () => clearInterval(t);
  }, [message.id, total, progressive]);

  return (
    <div className="flex flex-col gap-2" data-message-id={message.id}>
      {message.segments.slice(0, count).map((seg) => (
        <SegmentView key={seg.id} seg={seg} />
      ))}
    </div>
  );
}

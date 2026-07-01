"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  FEEDBACK_TAG_LABELS,
  type LineFeedback,
} from "@/lib/audit-schema";
import { useAuditHydrated, useAuditStore } from "@/lib/audit-store";
import { conversations } from "@/lib/load-conversation";
import { Badge } from "@/components/ui/badge";

/**
 * KB 리더 하단의 "이 문서를 인용한 피드백" 섹션.
 * audit-store 의 모든 피드백을 스캔하여 relatedKbIds 에 docId 가 포함된 항목을
 * 대화별로 그룹화하여 보여준다.
 */
export function ReferencingFeedback({ docId }: { docId: string }) {
  const hydrated = useAuditHydrated();
  const allFeedback = useAuditStore((s) => s.feedback);

  const grouped = useMemo(() => {
    if (!hydrated) return [] as Array<[string, LineFeedback[]]>;
    const buckets: Record<string, LineFeedback[]> = {};
    for (const f of allFeedback) {
      if (!f.relatedKbIds?.includes(docId)) continue;
      (buckets[f.conversationId] ??= []).push(f);
    }
    return Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b));
  }, [allFeedback, docId, hydrated]);

  const total = grouped.reduce((n, [, items]) => n + items.length, 0);

  if (!hydrated || total === 0) {
    return (
      <section className="mt-10 border-t pt-6">
        <h2 className="text-sm font-semibold">이 문서를 인용한 피드백</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {hydrated ? "아직 인용되지 않았습니다." : "불러오는 중…"}
        </p>
      </section>
    );
  }

  return (
    <section className="mt-10 border-t pt-6">
      <h2 className="text-sm font-semibold">
        이 문서를 인용한 피드백 ({total})
      </h2>
      <ul className="mt-3 flex flex-col gap-4">
        {grouped.map(([conversationId, items]) => {
          const conv = conversations[conversationId];
          const title = conv?.topic.title ?? conversationId;
          return (
            <li key={conversationId}>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <Link
                  href={`/audit/chat-logs/${conversationId}`}
                  className="text-sm font-medium underline-offset-2 hover:underline"
                >
                  {title}
                </Link>
                <span className="text-[10px] text-muted-foreground">
                  {items.length}건
                </span>
              </div>
              <ul className="flex flex-col gap-2">
                {items.map((f) => (
                  <li
                    key={f.id}
                    className="rounded-md border bg-muted/20 p-2 text-xs"
                  >
                    <p className="whitespace-pre-wrap text-foreground">
                      {f.body}
                    </p>
                    {f.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {f.tags.map((t) => (
                          <Badge
                            key={t}
                            variant="secondary"
                            className="text-[10px]"
                          >
                            {FEEDBACK_TAG_LABELS[t]}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {f.reviewer} ·{" "}
                      {new Date(f.createdAt).toLocaleDateString("ko-KR")}
                    </p>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

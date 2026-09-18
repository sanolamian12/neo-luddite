"use client";

import { Check, Minus, UserRound } from "lucide-react";
import type { UiBlock } from "@/lib/conversation-schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExpertHandoffBlock } from "./expert-handoff-block";

/**
 * 챗 메시지 내 구조화 UI (tool-ui 패턴을 shadcn으로 로컬 구현).
 * verdict_card: 판정 요약 / evidence_checklist: 필요 증빙 목록 / expert_handoff: 세무사 연결.
 */

const VERDICT_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  전부인정: "default",
  안분인정: "secondary",
  조건부: "outline",
  부인: "destructive",
};

function VerdictCard({
  block,
}: {
  block: Extract<UiBlock, { kind: "verdict_card" }>;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Badge variant={VERDICT_VARIANT[block.verdict] ?? "secondary"}>
            {block.verdict}
          </Badge>
          <CardTitle className="text-base">{block.title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {block.summary}
      </CardContent>
    </Card>
  );
}

function EvidenceChecklist({
  block,
}: {
  block: Extract<UiBlock, { kind: "evidence_checklist" }>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{block.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2 text-sm">
          {block.items.map((it, i) => (
            <li key={i} className="flex items-start gap-2">
              {it.required ? (
                <Check className="mt-0.5 size-4 shrink-0 text-primary" />
              ) : (
                <Minus className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              )}
              <span>
                <span className="font-medium">{it.label}</span>
                <span
                  className={
                    it.required
                      ? "ml-1 text-xs text-primary"
                      : "ml-1 text-xs text-muted-foreground"
                  }
                >
                  {it.required ? "필수" : "선택"}
                </span>
                {it.note && (
                  <span className="block text-xs text-muted-foreground">
                    {it.note}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** 검수 화면 등 사장님 채팅이 아닌 곳 — 연결 카드를 조작 없이 "제시됨"으로만 보인다. */
function ExpertHandoffNote({
  block,
}: {
  block: Extract<UiBlock, { kind: "expert_handoff" }>;
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
      <UserRound className="mt-0.5 size-3.5 shrink-0 text-brand-amber" />
      <span>
        <span className="font-medium text-foreground">세무사 연결 카드 제시</span> · {block.reason}
      </span>
    </div>
  );
}

export function UiBlocks({
  blocks,
  readOnly = false,
}: {
  blocks?: UiBlock[];
  /** true 면 상호작용 블록(세무사 연결)을 요약 표시로 대체. */
  readOnly?: boolean;
}) {
  if (!blocks?.length) return null;
  return (
    <div className="mt-3 flex flex-col gap-3">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "verdict_card":
            return <VerdictCard key={i} block={b} />;
          case "evidence_checklist":
            return <EvidenceChecklist key={i} block={b} />;
          case "expert_handoff":
            return readOnly ? (
              <ExpertHandoffNote key={i} block={b} />
            ) : (
              <ExpertHandoffBlock key={i} block={b} />
            );
          default: {
            // 새 kind 를 추가하면 여기서 컴파일 에러 — 조용히 빠지지 않게.
            const _exhaustive: never = b;
            return _exhaustive;
          }
        }
      })}
    </div>
  );
}

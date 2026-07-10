"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import type { Conversation } from "@/lib/conversation-schema";
import { useAuditStore } from "@/lib/audit-store";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { LineFeedbackPanel } from "../line-feedback-panel";
import { SessionEvalPanel } from "../session-eval-panel";

type TabValue = "feedback" | "evaluation" | "evidence";

/**
 * 우측 인스펙터 — 탭 3종 (피드백 · 평가 · 근거).
 * `근거`는 Tier 2 패널의 자리. v1은 선택 문장의 인용·메타 노출만.
 */
export function Inspector({
  conversationId,
  conversation,
  mobileShow = false,
}: {
  conversationId: string;
  conversation: Conversation;
  /** 모바일(<md)에서 탭으로 노출할지. 데스크톱은 항상 표시. */
  mobileShow?: boolean;
}) {
  return (
    <aside
      className={cn(
        "w-full shrink-0 flex-col overflow-hidden border-l md:flex md:w-[360px]",
        mobileShow ? "flex" : "hidden md:flex",
      )}
    >
      <TabsPrimitive.Root
        defaultValue={"feedback" satisfies TabValue}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <TabsPrimitive.List className="flex shrink-0 border-b">
          <TabTrigger value="feedback">피드백</TabTrigger>
          <TabTrigger value="evaluation">평가</TabTrigger>
          <TabTrigger value="evidence">근거</TabTrigger>
        </TabsPrimitive.List>

        <TabsPrimitive.Panel value="feedback" className="flex-1 overflow-y-auto p-4">
          <LineFeedbackPanel
            conversationId={conversationId}
            conversation={conversation}
          />
        </TabsPrimitive.Panel>

        <TabsPrimitive.Panel value="evaluation" className="flex-1 overflow-y-auto p-4">
          <SessionEvalPanel conversationId={conversationId} />
        </TabsPrimitive.Panel>

        <TabsPrimitive.Panel value="evidence" className="flex-1 overflow-y-auto p-4">
          <EvidencePanel conversation={conversation} />
        </TabsPrimitive.Panel>
      </TabsPrimitive.Root>
    </aside>
  );
}

function TabTrigger({
  value,
  children,
}: {
  value: TabValue;
  children: React.ReactNode;
}) {
  return (
    <TabsPrimitive.Tab
      value={value}
      className={cn(
        "flex-1 px-3 py-2 text-sm text-muted-foreground transition outline-none",
        "hover:text-foreground focus-visible:bg-muted",
        "data-selected:border-b-2 data-selected:border-foreground data-selected:font-medium data-selected:text-foreground",
      )}
    >
      {children}
    </TabsPrimitive.Tab>
  );
}

/** Tier 2 근거 패널 stub — 선택 문장의 인용·프레임워크만 노출. */
function EvidencePanel({ conversation }: { conversation: Conversation }) {
  const selectedSegmentId = useAuditStore((s) => s.selectedSegmentId);
  const segment = conversation.messages
    .flatMap((m) => m.segments)
    .find((s) => s.id === selectedSegmentId);

  if (!segment) {
    return (
      <p className="text-sm text-muted-foreground">
        왼쪽에서 문장을 선택하면 인용·프레임워크 메타가 표시됩니다.
      </p>
    );
  }

  const hasMeta = Boolean(segment.framework || segment.citations?.length);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold">선택 문장</h2>
        <p className="mt-1 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
          {segment.text}
        </p>
      </div>

      <div>
        <h3 className="text-xs font-medium text-muted-foreground">메타</h3>
        {hasMeta ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {segment.framework && (
              <Badge variant="secondary" className="text-[10px]">
                {segment.framework}
              </Badge>
            )}
            {segment.citations?.map((c) => (
              <Badge key={c} variant="outline" className="text-[10px]">
                {c}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            이 문장에는 등록된 메타가 없습니다.
          </p>
        )}
      </div>

      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        Tier 2 근거 패널은 추후 단계(B5·B6)에서 KB 문서 · 케이스 코퍼스
        검색으로 확장됩니다.
      </div>
    </div>
  );
}

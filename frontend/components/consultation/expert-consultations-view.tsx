"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAccountStore } from "@/lib/account-store";
import { useAuditorRegistryStore } from "@/lib/auditor-registry-store";
import { useConsultationHydrated, useConsultationStore } from "@/lib/consultation-store";
import { useConversationStore, type ConversationRecord } from "@/lib/conversation-store";
import type { ConsultationRequest } from "@/lib/poc-schema";
import { cn } from "@/lib/utils";
import { ConsultationListItem, sortConsultations } from "./consultation-parts";
import { StaffConsultationDetail } from "./staff-consultation-detail";

type Filter = "all" | "pending" | "accepted" | "closed";

const FILTER_LABEL: Record<Filter, string> = {
  all: "전체",
  pending: "대기",
  accepted: "진행 중",
  closed: "종료",
};

function matches(filter: Filter, r: ConsultationRequest): boolean {
  if (filter === "all") return true;
  if (filter === "closed") return r.status !== "pending" && r.status !== "accepted";
  return r.status === filter;
}

/** 사장님 표기: 대화에 저장된 owner_label → domain id. */
export function ownerNameOf(r: ConsultationRequest, conv: ConversationRecord | undefined): string {
  return conv?.ownerLabel || r.viewerId;
}

/**
 * 세무사 "상담 신청" (/audit/consultations) — 내 앞으로 온 신청을 수락/거절/완료.
 */
export function ExpertConsultationsView({ initialId }: { initialId?: string }) {
  const hydrated = useConsultationHydrated();
  const auditor = useAccountStore((s) => s.auditor);
  const requests = useConsultationStore((s) => s.requests);
  const records = useConversationStore((s) => s.records);
  const myName = useAuditorRegistryStore(
    (s) => s.auditors.find((a) => a.id === auditor.id)?.displayName,
  );

  const mine = useMemo(
    () => sortConsultations(requests.filter((r) => r.expertId === auditor.id)),
    [requests, auditor.id],
  );
  const [filter, setFilter] = useState<Filter>("all");
  const list = useMemo(() => mine.filter((r) => matches(filter, r)), [mine, filter]);

  const [selectedId, setSelectedId] = useState<string | null>(initialId ?? null);
  const [mobileView, setMobileView] = useState<"list" | "detail">(
    initialId ? "detail" : "list",
  );

  const convOf = (r: ConsultationRequest) => records.find((c) => c.id === r.conversationId);
  // 아무것도 고르지 않았으면 목록 맨 위를 보여 준다.
  const activeId = selectedId ?? list[0]?.id ?? null;
  const selected = mine.find((r) => r.id === activeId) ?? null;

  if (!hydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">불러오는 중…</div>;
  }

  if (mine.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <Inbox className="size-8 text-muted-foreground" />
        <h1 className="text-lg font-semibold">아직 받은 상담 신청이 없습니다</h1>
        <p className="text-sm break-keep text-muted-foreground">
          상담 프로필을 “노출 중”으로 두면 AI 상담 중인 사장님이 세무사 연결 카드에서 신청할 수
          있습니다.
        </p>
        <Button variant="outline" render={<Link href="/audit/profile" />}>
          상담 프로필 보기
        </Button>
      </div>
    );
  }

  const count = (f: Filter) => mine.filter((r) => matches(f, r)).length;

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        className={cn(
          "w-full shrink-0 flex-col border-r md:flex md:w-[340px]",
          mobileView === "detail" ? "hidden md:flex" : "flex",
        )}
      >
        <div className="border-b px-4 py-3">
          <h1 className="text-sm font-semibold">상담 신청</h1>
          <div className="mt-2 flex flex-wrap gap-1">
            {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
              <Button
                key={f}
                size="xs"
                variant={filter === f ? "default" : "outline"}
                onClick={() => setFilter(f)}
              >
                {FILTER_LABEL[f]} {count(f)}
              </Button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">해당하는 신청이 없습니다.</p>
          ) : (
            list.map((r) => {
              const conv = convOf(r);
              return (
                <ConsultationListItem
                  key={r.id}
                  request={r}
                  title={ownerNameOf(r, conv)}
                  subtitle={conv?.title ?? r.message}
                  selected={r.id === activeId}
                  onSelect={() => {
                    setSelectedId(r.id);
                    setMobileView("detail");
                  }}
                />
              );
            })
          )}
        </div>
      </aside>

      <div
        className={cn(
          "min-w-0 flex-1 overflow-y-auto",
          mobileView === "list" ? "hidden md:block" : "block",
        )}
      >
        <button
          type="button"
          onClick={() => setMobileView("list")}
          className="flex w-full items-center gap-1 border-b px-4 py-2 text-sm text-muted-foreground md:hidden"
        >
          ← 신청 목록
        </button>
        {selected ? (
          <StaffConsultationDetail
            key={selected.id}
            request={selected}
            ownerName={ownerNameOf(selected, convOf(selected))}
            expertName={myName ?? auditor.reviewerName}
            canAct
            readerId={auditor.id}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            왼쪽에서 신청을 선택하세요.
          </div>
        )}
      </div>
    </div>
  );
}

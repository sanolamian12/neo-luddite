"use client";

import { useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuditorRegistryStore } from "@/lib/auditor-registry-store";
import { useConsultationHydrated, useConsultationStore } from "@/lib/consultation-store";
import { useConversationStore } from "@/lib/conversation-store";
import type { ConsultationRequest, ConsultationStatus } from "@/lib/poc-schema";
import { cn } from "@/lib/utils";
import { STATUS_LABEL } from "@/services/consultation";
import { ConsultationListItem, STATUS_ORDER, sortConsultations } from "./consultation-parts";
import { ownerNameOf } from "./expert-consultations-view";
import { StaffConsultationDetail } from "./staff-consultation-detail";
import { LoadingBlock } from "@/components/ui/spinner";
import { AdminOffersPanel } from "./admin-offers-panel";
import { AdminPoolPanel } from "./admin-pool-panel";
import { AdminRoomsPanel } from "./admin-rooms-panel";
import { StatTile } from "./admin-ops-parts";

/**
 * 관리자 상담 화면 (/admin/consultations) — 탭 4개 (§4.3, 후속 2단계).
 *
 *   신청(경로 A) / 제안(경로 B) / 채팅방 / 풀 동의·열람
 *
 * 신청 탭은 읽기 전용(전이는 당사자가 한다). 나머지 셋은 집계 + **브레이크**만 준다 —
 * 방 강제 종료 · 동의 강제 철회 · 대기 제안 거절·철회. 승인 쪽 전이는 어느 탭에도 없다.
 * 탭 본문은 고른 탭만 그린다(풀 탭은 열 때 직접 당긴다 — 그 두 테이블은 Realtime 이 아니다).
 */
const TAB_LABEL = {
  requests: "신청",
  offers: "제안",
  rooms: "채팅방",
  pool: "풀 동의·열람",
} as const;
type TabKey = keyof typeof TAB_LABEL;

export function AdminConsultationsView({ initialId }: { initialId?: string }) {
  const [tab, setTab] = useState<TabKey>("requests");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-4 pt-4 pb-3 md:px-6">
        <h1 className="text-lg font-semibold">상담 운영</h1>
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as TabKey)}
          className="mt-2"
          data-testid="admin-consultation-tabs"
        >
          <TabsList className="w-full">
            {(Object.keys(TAB_LABEL) as TabKey[]).map((k) => (
              <TabsTrigger
                key={k}
                value={k}
                className="px-2 text-xs sm:text-sm"
                data-testid={`admin-tab-${k}`}
              >
                {TAB_LABEL[k]}
              </TabsTrigger>
            ))}
          </TabsList>
          {(Object.keys(TAB_LABEL) as TabKey[]).map((k) => (
            <TabsContent key={k} value={k} className="hidden" />
          ))}
        </Tabs>
      </div>
      {tab === "requests" ? (
        <AdminRequestsPanel initialId={initialId} />
      ) : tab === "offers" ? (
        <AdminOffersPanel />
      ) : tab === "rooms" ? (
        <AdminRoomsPanel />
      ) : (
        <AdminPoolPanel />
      )}
    </div>
  );
}

/** 신청 탭 — 경로 A 신청 전체 · 상태별 집계 · 세무사별 필터(읽기 전용). */
function AdminRequestsPanel({ initialId }: { initialId?: string }) {
  const hydrated = useConsultationHydrated();
  const requests = useConsultationStore((s) => s.requests);
  const records = useConversationStore((s) => s.records);
  const auditors = useAuditorRegistryStore((s) => s.auditors);

  const [status, setStatus] = useState<ConsultationStatus | "all">("all");
  const [expertId, setExpertId] = useState<string>("all");

  const all = useMemo(() => sortConsultations(requests), [requests]);
  const byExpert = useMemo(
    () => (expertId === "all" ? all : all.filter((r) => r.expertId === expertId)),
    [all, expertId],
  );
  const list = useMemo(
    () => (status === "all" ? byExpert : byExpert.filter((r) => r.status === status)),
    [byExpert, status],
  );
  const counts = useMemo(() => {
    const c = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<
      ConsultationStatus,
      number
    >;
    for (const r of byExpert) c[r.status] += 1;
    return c;
  }, [byExpert]);

  const expertIds = useMemo(() => [...new Set(all.map((r) => r.expertId))], [all]);
  const expertName = (id: string) => auditors.find((a) => a.id === id)?.displayName ?? id;
  const convOf = (r: ConsultationRequest) => records.find((c) => c.id === r.conversationId);

  const [selectedId, setSelectedId] = useState<string | null>(initialId ?? null);
  const [mobileView, setMobileView] = useState<"list" | "detail">(
    initialId ? "detail" : "list",
  );
  // 아무것도 고르지 않았으면 목록 맨 위를 보여 준다.
  const activeId = selectedId ?? list[0]?.id ?? null;
  const selected = all.find((r) => r.id === activeId) ?? null;

  if (!hydrated) {
    return <LoadingBlock label="불러오는 중…" />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-4 py-4 md:px-6">
        <p className="text-xs text-muted-foreground">
          사장님이 AI 상담에서 세무사에게 넣은 신청 전체. 수락·거절·완료는 담당 세무사가 처리합니다.
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
          <StatTile
            label="전체"
            value={byExpert.length}
            active={status === "all"}
            onClick={() => setStatus("all")}
          />
          {STATUS_ORDER.map((s) => (
            <StatTile
              key={s}
              label={STATUS_LABEL[s]}
              value={counts[s]}
              active={status === s}
              warn={s === "pending" && counts[s] > 0}
              onClick={() => setStatus(s)}
            />
          ))}
        </div>
        <label className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          세무사
          <select
            value={expertId}
            onChange={(e) => setExpertId(e.target.value)}
            className="h-7 rounded-md border bg-background px-2 text-sm text-foreground"
          >
            <option value="all">전체</option>
            {expertIds.map((id) => (
              <option key={id} value={id}>
                {expertName(id)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            "w-full shrink-0 flex-col border-r md:flex md:w-[340px]",
            mobileView === "detail" ? "hidden md:flex" : "flex",
          )}
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            {list.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">해당하는 신청이 없습니다.</p>
            ) : (
              list.map((r) => (
                <ConsultationListItem
                  key={r.id}
                  request={r}
                  title={`${ownerNameOf(r, convOf(r))} → ${expertName(r.expertId)}`}
                  subtitle={convOf(r)?.title ?? r.message}
                  selected={r.id === activeId}
                  onSelect={() => {
                    setSelectedId(r.id);
                    setMobileView("detail");
                  }}
                />
              ))
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
              expertName={expertName(selected.expertId)}
              canAct={false}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {all.length === 0 ? "아직 들어온 상담 신청이 없습니다." : "왼쪽에서 신청을 선택하세요."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

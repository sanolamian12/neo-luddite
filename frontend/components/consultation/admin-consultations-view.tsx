"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
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

/**
 * 관리자 "상담 신청" (/admin/consultations) — 전체 신청 · 상태별 집계 · 세무사별 필터.
 * 읽기 전용(전이는 당사자가 한다). DB 함수는 admin 전이를 허용하므로 필요해지면 여기서 붙인다.
 */
export function AdminConsultationsView({ initialId }: { initialId?: string }) {
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
        <h1 className="text-lg font-semibold">상담 신청</h1>
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

function StatTile({
  label,
  value,
  active,
  warn = false,
  onClick,
}: {
  label: string;
  value: number;
  active: boolean;
  warn?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-auto flex-col items-start gap-0.5 px-3 py-2",
        active && "border-primary bg-primary/5",
      )}
    >
      <span className="text-[11px] font-normal text-muted-foreground">{label}</span>
      <span className={cn("text-lg font-semibold tabular-nums", warn && "text-brand-amber")}>
        {value}
      </span>
    </Button>
  );
}

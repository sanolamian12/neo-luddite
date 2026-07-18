"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CheckCircle2, XCircle, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuditWorkHydrated, useAuditWorkStore } from "@/lib/audit-work-store";
import { useAuditStore, useAuditHydrated } from "@/lib/audit-store";
import { useAccountStore } from "@/lib/account-store";
import { getConversation } from "@/lib/load-conversation";
import { getOccupation } from "@/lib/occupations";
import {
  evalContributionUnits,
  SCORE_CATEGORY_LABELS,
  type EvalReviewStatus,
} from "@/lib/audit-schema";
import { formatDate, formatDateTime } from "@/lib/poc-format";
import { cn, middleTruncate } from "@/lib/utils";
import * as sessionReviewService from "@/services/session-review";

/**
 * 검수실 (정성 평가) 상세 — 왼쪽은 전사(맥락), 오른쪽 **전체**를 세션 평가가 쓴다.
 *
 * 문장 단위 검수실과 대칭: 저기는 오른쪽을 평가자 피드백이 다 쓰고 세션 평가가 없다.
 * 버튼은 [인정] [거절] [검수 저장] 셋뿐이며, 검수 저장은 결정이 있어야만 눌린다.
 * (최종 승인은 목록의 일괄 승인에서 한다 — 문장 단위와 달리 건별 확정 버튼을 두지 않는다.)
 */

const STATUS_LABEL: Record<EvalReviewStatus, string> = {
  pending: "검수 대기",
  saved: "검수 저장",
  finalized: "최종 승인",
};

export function InspectionEvalWorkspace({
  evaluationId,
}: {
  evaluationId: string;
}) {
  const workHydrated = useAuditWorkHydrated();
  const auditHydrated = useAuditHydrated();
  const audits = useAuditWorkStore((s) => s.audits);
  const evaluations = useAuditStore((s) => s.evaluations);
  const adminId = useAccountStore((s) => s.admin.id);

  const [mobileTab, setMobileTab] = useState<"transcript" | "decision">(
    "transcript",
  );
  const [saving, setSaving] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const evaluation = useMemo(
    () => evaluations.find((e) => e.id === evaluationId) ?? null,
    [evaluations, evaluationId],
  );
  const conv = evaluation ? getConversation(evaluation.conversationId) : null;
  const audit = useMemo(
    () =>
      evaluation
        ? audits.find(
            (a) =>
              a.conversationId === evaluation.conversationId &&
              a.auditorId === evaluation.auditorId,
          ) ?? null
        : null,
    [audits, evaluation],
  );

  if (!workHydrated || !auditHydrated) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        로딩 중…
      </div>
    );
  }

  if (!evaluation || !conv) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2">
        <p className="text-sm">정성 평가를 찾을 수 없습니다.</p>
        <Link href="/admin/inspection-eval" className="text-sm underline">
          검수 큐로
        </Link>
      </div>
    );
  }

  const locked = evaluation.reviewStatus === "finalized";
  const isSaved = evaluation.reviewStatus === "saved";
  const canSave = Boolean(evaluation.decision) && !locked;
  const units = evalContributionUnits(evaluation.qualitative);

  const onDecide = async (decision: "accepted" | "rejected") => {
    if (locked || deciding || saving) return;
    setError(null);
    setDeciding(true);
    try {
      await sessionReviewService.setDecision(evaluation.id, decision, adminId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeciding(false);
    }
  };

  const onSave = async () => {
    if (!canSave || saving || deciding) return;
    setError(null);
    setSaving(true);
    try {
      await sessionReviewService.save(evaluation.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const occ = getOccupation(conv.persona.occupation);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-mono text-xs text-muted-foreground">
              {evaluation.id}
            </p>
            {audit && (
              <Link
                href={`/admin/tasks/${audit.taskId}`}
                className="font-mono text-xs text-muted-foreground hover:underline"
                title={audit.taskId}
              >
                ← {middleTruncate(audit.taskId)}
              </Link>
            )}
            <span className="text-xs text-muted-foreground">·</span>
            <span
              className="text-xs text-muted-foreground"
              title={evaluation.auditorId}
            >
              평가자 {evaluation.reviewer}
            </span>
          </div>
          <h1 className="truncate text-base font-semibold leading-tight">
            {conv.topic.title}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {occ ? `${occ.emoji} ${occ.label}` : conv.persona.label} ·{" "}
            {conv.topic.taxCategory} · 제출{" "}
            {formatDate(audit?.submittedAt ?? evaluation.createdAt)}
          </p>
        </div>
        <Badge className="text-[10px]">
          {STATUS_LABEL[evaluation.reviewStatus]}
        </Badge>
      </header>

      {/* 모바일 탭 전환기 */}
      <div className="flex shrink-0 border-b md:hidden">
        <button
          type="button"
          onClick={() => setMobileTab("transcript")}
          className={cn(
            "flex-1 px-3 py-2 text-sm font-medium transition",
            mobileTab === "transcript"
              ? "border-b-2 border-foreground text-foreground"
              : "text-muted-foreground",
          )}
        >
          전사
        </button>
        <button
          type="button"
          onClick={() => setMobileTab("decision")}
          className={cn(
            "flex-1 px-3 py-2 text-sm font-medium transition",
            mobileTab === "decision"
              ? "border-b-2 border-foreground text-foreground"
              : "text-muted-foreground",
          )}
        >
          세션 평가
        </button>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* 전사 read-only — 총평이 무엇을 두고 한 말인지의 맥락 */}
        <main
          className={cn(
            "min-w-0 flex-1 overflow-y-auto px-4 py-4 md:block md:px-6",
            mobileTab === "decision" ? "hidden" : "block",
          )}
        >
          {conv.messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                "mb-3 rounded-lg border px-3 py-2",
                m.role === "assistant" ? "bg-card" : "bg-muted/50",
              )}
            >
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {m.role}
              </div>
              <div className="flex flex-col gap-1">
                {m.segments.map((s) => (
                  <p key={s.id} className="text-sm leading-relaxed">
                    {s.text}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </main>

        {/* 인스펙터 — 오른쪽 전체를 세션 평가가 쓴다 */}
        <aside
          className={cn(
            "w-full shrink-0 flex-col overflow-hidden border-l md:flex md:w-[420px]",
            mobileTab === "decision" ? "flex" : "hidden md:flex",
          )}
        >
          <div className="flex shrink-0 border-b">
            <div className="flex-1 border-b-2 border-foreground px-3 py-2 text-sm font-medium">
              세션 평가
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex flex-col gap-4">
              <section>
                <h2 className="text-sm font-semibold">평점</h2>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {(
                    [
                      ["writing", evaluation.scores.writing],
                      ["legalAccuracy", evaluation.scores.legalAccuracy],
                    ] as const
                  ).map(([key, value]) => (
                    <div
                      key={key}
                      className="rounded-md border bg-muted/30 px-3 py-2"
                    >
                      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        {SCORE_CATEGORY_LABELS[key]}
                      </p>
                      <p className="mt-0.5 text-lg font-semibold tabular-nums">
                        {value}
                        <span className="text-sm font-normal text-muted-foreground">
                          /5
                        </span>
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              {/* 결정을 총평 **위**에 둔다 — 총평이 1000자를 넘는 일이 흔해서,
                  아래에 두면 [인정]/[거절] 이 스크롤 밖으로 밀려 안 보인다. */}
              <section>
                <h3 className="text-sm font-semibold">결정</h3>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Button
                    variant={
                      evaluation.decision === "accepted" ? "default" : "outline"
                    }
                    onClick={() => onDecide("accepted")}
                    disabled={locked || deciding || saving}
                  >
                    <CheckCircle2 className="size-3.5" />
                    인정
                  </Button>
                  <Button
                    variant={
                      evaluation.decision === "rejected" ? "default" : "outline"
                    }
                    onClick={() => onDecide("rejected")}
                    disabled={locked || deciding || saving}
                  >
                    <XCircle className="size-3.5" />
                    거절
                  </Button>
                </div>
                {evaluation.decidedAt && (
                  <p className="mt-1.5 text-[10px] text-muted-foreground">
                    {formatDateTime(evaluation.decidedAt)}
                    {evaluation.decidedBy ? ` · ${evaluation.decidedBy}` : ""}
                  </p>
                )}
              </section>

              <section>
                <h2 className="text-sm font-semibold">
                  세션 전체 평가의견
                  <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">
                    {evaluation.qualitative.trim().length}자 · 기여 {units}
                  </span>
                </h2>
                {evaluation.qualitative.trim() ? (
                  <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-sm leading-relaxed">
                    {evaluation.qualitative}
                  </p>
                ) : (
                  <p className="mt-2 rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                    작성된 총평이 없습니다. (기여 0 · RAG 적재 대상 아님)
                  </p>
                )}
              </section>
            </div>
          </div>
        </aside>
      </div>

      {/* 푸터 — [검수 저장] 하나. 결정이 있어야만 눌린다. */}
      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t bg-card px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          {evaluation.decision === "accepted" && (
            <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900">
              인정 · 기여 {units}
            </span>
          )}
          {evaluation.decision === "rejected" && (
            <span className="rounded-md bg-rose-100 px-2 py-0.5 text-xs text-rose-900">
              거절 · 기여 0
            </span>
          )}
          {!evaluation.decision && (
            <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
              미결정
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {locked ? (
            <div className="text-xs text-muted-foreground">
              최종 승인 완료 · 배선실 (정성 평가) 적재됨
            </div>
          ) : isSaved ? (
            <>
              <span className="text-xs text-muted-foreground">
                저장됨 · 목록에서 최종 승인
              </span>
              <Button onClick={onSave} disabled={!canSave || saving || deciding}>
                <Save className="size-3.5" />
                {saving ? "저장 중…" : "검수 저장"}
              </Button>
            </>
          ) : (
            <Button onClick={onSave} disabled={!canSave || saving || deciding}>
              <Save className="size-3.5" />
              {saving ? "저장 중…" : "검수 저장"}
            </Button>
          )}
        </div>
      </footer>

      {error && (
        <div className="border-t border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}

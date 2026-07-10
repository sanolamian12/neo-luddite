"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Boxes, GitMerge, GitPullRequest, Rocket, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePipelineHydrated, usePipelineStore } from "@/lib/pipeline-store";
import { useReviewStore, useReviewHydrated } from "@/lib/review-store";
import { useAuditStore } from "@/lib/audit-store";
import { useAuditWorkStore } from "@/lib/audit-work-store";
import { formatDateTime } from "@/lib/poc-format";
import { cn, middleTruncate } from "@/lib/utils";
import type { BatchStatus, VersionStatus } from "@/lib/poc-schema";

const BATCH_STATUS_LABEL: Record<BatchStatus, string> = {
  queued: "대기",
  in_pipeline: "파이프라인 중",
  merged: "머지됨",
  deployed: "배포됨",
  cancelled: "취소",
  pipeline_failed: "실패",
};
const BATCH_STATUS_VARIANT: Record<BatchStatus, "default" | "secondary" | "outline" | "destructive"> = {
  queued: "outline",
  in_pipeline: "default",
  merged: "secondary",
  deployed: "default",
  cancelled: "outline",
  pipeline_failed: "destructive",
};
const VERSION_STATUS_LABEL: Record<VersionStatus, string> = {
  candidate: "후보",
  production: "프로덕션",
  rolled_back: "롤백됨",
  superseded: "교체됨",
};
const VERSION_STATUS_VARIANT: Record<VersionStatus, "default" | "secondary" | "outline" | "destructive"> = {
  candidate: "outline",
  production: "default",
  rolled_back: "destructive",
  superseded: "secondary",
};

export function PipelineDashboard() {
  const hydrated = usePipelineHydrated();
  const reviewHydrated = useReviewHydrated();
  const batches = usePipelineStore((s) => s.batches);
  const versions = usePipelineStore((s) => s.versions);
  const reviews = useReviewStore((s) => s.reviews);
  const feedback = useAuditStore((s) => s.feedback);
  const audits = useAuditWorkStore((s) => s.audits);

  const summary = useMemo(() => {
    const currentProd = versions.find((v) => v.status === "production");
    const inPipeline = batches.filter(
      (b) => b.status === "in_pipeline" || b.status === "merged",
    );

    // 인정된 feedback 중 활성 batch 에 안 들어간 것
    const usedKeys = new Set<string>();
    for (const b of batches) {
      if (b.status === "cancelled" || b.status === "pipeline_failed") continue;
      for (const af of b.acceptedFeedbacks) {
        usedKeys.add(`${af.auditId}::${af.feedbackId}`);
      }
    }
    let eligible = 0;
    let eligibleAuditors = new Set<string>();
    for (const r of reviews) {
      if (r.status !== "finalized") continue;
      const audit = audits.find((a) => a.id === r.auditId);
      if (!audit) continue;
      for (const d of r.decisions) {
        if (!d.accepted) continue;
        const f = feedback.find((x) => x.id === d.feedbackId);
        if (!f) continue;
        const key = `${audit.id}::${d.feedbackId}`;
        if (usedKeys.has(key)) continue;
        eligible += 1;
        eligibleAuditors.add(audit.auditorId);
      }
    }

    return {
      currentProd,
      inPipeline,
      eligible,
      eligibleAuditors: eligibleAuditors.size,
    };
  }, [batches, versions, reviews, audits, feedback]);

  const recentVersions = useMemo(
    () =>
      versions
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 5),
    [versions],
  );

  if (!hydrated || !reviewHydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">모델 파이프라인</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            인정 피드백 → Training Batch → PR → ModelVersion 의 mock 흐름.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" render={<Link href="/admin/pipeline/batches" />}>
            <Boxes className="size-3.5" />
            Batch 목록
          </Button>
          <Button variant="outline" render={<Link href="/admin/pipeline/versions" />}>
            <GitMerge className="size-3.5" />
            버전 목록
          </Button>
        </div>
      </header>

      {/* 현재 production */}
      <section className="rounded-xl border bg-card">
        <header className="border-b px-4 py-2 text-sm font-semibold">
          현재 production
        </header>
        {!summary.currentProd ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            아직 배포된 모델 버전이 없습니다.
          </p>
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-2xl font-bold tabular-nums">
                <span title={summary.currentProd.id}>{middleTruncate(summary.currentProd.id)}</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                배포 {formatDateTime(summary.currentProd.promotedAt ?? summary.currentProd.createdAt)}
                {summary.currentProd.sourcePr && (
                  <>
                    {" · "}
                    <a
                      href={summary.currentProd.sourcePr.prUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      PR #{summary.currentProd.sourcePr.prNumber}
                    </a>
                  </>
                )}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                source batches: {summary.currentProd.mergedFromBatchIds.length}건
              </p>
              {summary.currentProd.metrics && (
                <div className="mt-2 flex gap-2">
                  {summary.currentProd.metrics.accuracy !== undefined && (
                    <Badge variant="secondary" className="text-[10px]">
                      acc {Math.round((summary.currentProd.metrics.accuracy ?? 0) * 1000) / 10}%
                    </Badge>
                  )}
                  {summary.currentProd.metrics.coverage !== undefined && (
                    <Badge variant="secondary" className="text-[10px]">
                      cov {Math.round((summary.currentProd.metrics.coverage ?? 0) * 1000) / 10}%
                    </Badge>
                  )}
                </div>
              )}
            </div>
            <Button
              variant="destructive"
              render={
                <Link href={`/admin/pipeline/versions/${encodeURIComponent(summary.currentProd.id)}`} />
              }
            >
              <RotateCcw className="size-3.5" />
              롤백 / 상세
            </Button>
          </div>
        )}
      </section>

      {/* 진행 중 batch */}
      <section className="rounded-xl border bg-card">
        <header className="border-b px-4 py-2 text-sm font-semibold">진행 중</header>
        {summary.inPipeline.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            현재 진행 중인 batch 가 없습니다.
          </p>
        ) : (
          <ul className="divide-y">
            {summary.inPipeline.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    <Link
                      href={`/admin/pipeline/batches/${b.id}`}
                      className="hover:underline"
                      title={b.label}
                    >
                      {b.label}
                    </Link>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {b.acceptedFeedbacks.length} feedback · 평가자 {b.contributorIds.length}명
                    {b.prMeta && (
                      <>
                        {" · "}
                        <a
                          href={b.prMeta.prUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                        >
                          PR #{b.prMeta.prNumber}
                        </a>{" "}
                        <span
                          className={cn(
                            "rounded-md px-1.5 py-0.5 text-[10px]",
                            b.prMeta.ciStatus === "green" && "bg-emerald-100 text-emerald-900",
                            b.prMeta.ciStatus === "pending" && "bg-amber-100 text-amber-900",
                            b.prMeta.ciStatus === "red" && "bg-rose-100 text-rose-900",
                          )}
                        >
                          CI {b.prMeta.ciStatus ?? "—"}
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <Badge variant={BATCH_STATUS_VARIANT[b.status]}>
                  {BATCH_STATUS_LABEL[b.status]}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 묶을 수 있는 피드백 */}
      <section className="rounded-xl border bg-card">
        <header className="border-b px-4 py-2 text-sm font-semibold">
          묶을 수 있는 피드백
        </header>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-3xl font-bold tabular-nums">{summary.eligible}건</p>
            <p className="mt-1 text-xs text-muted-foreground">
              인정 + (이의 기간 종료 또는 미포함) · 평가자 {summary.eligibleAuditors}명
            </p>
          </div>
          <Button
            disabled={summary.eligible === 0}
            render={<Link href="/admin/pipeline/batches/new" />}
          >
            <GitPullRequest className="size-3.5" />새 Batch 만들기
          </Button>
        </div>
      </section>

      {/* 최근 버전 */}
      <section className="rounded-xl border bg-card">
        <header className="flex items-center justify-between border-b px-4 py-2">
          <span className="text-sm font-semibold">최근 버전</span>
          <Link href="/admin/pipeline/versions" className="text-xs underline">
            모두 보기 →
          </Link>
        </header>
        {recentVersions.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            발행된 버전이 없습니다.
          </p>
        ) : (
          <ul className="divide-y text-sm">
            {recentVersions.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <Link
                  href={`/admin/pipeline/versions/${encodeURIComponent(v.id)}`}
                  className="font-mono font-medium hover:underline"
                  title={v.id}
                >
                  {middleTruncate(v.id)}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(v.createdAt)}
                </span>
                <Badge variant={VERSION_STATUS_VARIANT[v.status]}>
                  {VERSION_STATUS_LABEL[v.status]}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Tip */}
      <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
        <Rocket className="mr-1 inline-block size-3" />이 PoC 에서 PR / 학습 / 배포는 모두 시뮬레이션입니다.
        실 백엔드 연결 시 service 함수의 내부만 GitHub API / CI webhook 호출로 교체됩니다.
      </p>
    </div>
  );
}

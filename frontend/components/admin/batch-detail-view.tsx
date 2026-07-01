"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePipelineHydrated, usePipelineStore } from "@/lib/pipeline-store";
import { useAuditStore } from "@/lib/audit-store";
import { useAuditWorkStore } from "@/lib/audit-work-store";
import { conversations } from "@/lib/load-conversation";
import { formatDateTime } from "@/lib/poc-format";
import { cn } from "@/lib/utils";
import * as pipelineService from "@/services/pipeline";
import type { BatchStatus } from "@/lib/poc-schema";

const STATUS_LABEL: Record<BatchStatus, string> = {
  queued: "대기",
  in_pipeline: "파이프라인 중",
  merged: "머지됨",
  deployed: "배포됨",
  cancelled: "취소",
  pipeline_failed: "실패",
};
const STATUS_VARIANT: Record<BatchStatus, "default" | "secondary" | "outline" | "destructive"> = {
  queued: "outline",
  in_pipeline: "default",
  merged: "secondary",
  deployed: "default",
  cancelled: "outline",
  pipeline_failed: "destructive",
};

export function BatchDetailView({ batchId }: { batchId: string }) {
  const router = useRouter();
  const hydrated = usePipelineHydrated();
  const batches = usePipelineStore((s) => s.batches);
  const audits = useAuditWorkStore((s) => s.audits);
  const feedback = useAuditStore((s) => s.feedback);

  const batch = useMemo(
    () => batches.find((b) => b.id === batchId) ?? null,
    [batches, batchId],
  );

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!hydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }
  if (!batch) {
    return (
      <div className="px-6 py-10">
        <h1 className="text-2xl font-bold">Batch 를 찾을 수 없습니다</h1>
        <Link href="/admin/pipeline/batches" className="mt-2 inline-block text-sm underline">
          ← 목록
        </Link>
      </div>
    );
  }

  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6 px-6 py-6 max-w-4xl">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-muted-foreground">{batch.id}</p>
          <h1 className="text-2xl font-bold tracking-tight">{batch.label}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={STATUS_VARIANT[batch.status]}>{STATUS_LABEL[batch.status]}</Badge>
            <span>생성 {formatDateTime(batch.createdAt)}</span>
            <span>·</span>
            <span>by {batch.createdBy}</span>
          </div>
          {batch.notes && <p className="mt-2 text-sm">{batch.notes}</p>}
        </div>
        <Link href="/admin/pipeline/batches" className="text-sm underline">
          ← 목록
        </Link>
      </header>

      {/* 메타 카드 */}
      <section className="grid grid-cols-3 divide-x rounded-xl border bg-card">
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground">포함 피드백</p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums">
            {batch.acceptedFeedbacks.length}
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground">기여 평가자</p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums">
            {batch.contributorIds.length}
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground">ModelVersion</p>
          <p className="mt-0.5 font-mono">
            {batch.targetModelVersion ? (
              <Link
                href={`/admin/pipeline/versions/${encodeURIComponent(batch.targetModelVersion)}`}
                className="underline"
              >
                {batch.targetModelVersion}
              </Link>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </p>
        </div>
      </section>

      {/* PR 메타 */}
      {batch.prMeta && (
        <section className="rounded-xl border bg-card px-4 py-3">
          <h2 className="text-sm font-semibold">PR (mock)</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            <a
              href={batch.prMeta.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              #{batch.prMeta.prNumber}
            </a>{" "}
            · branch {batch.prMeta.branch} ·{" "}
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[10px]",
                batch.prMeta.ciStatus === "green" && "bg-emerald-100 text-emerald-900",
                batch.prMeta.ciStatus === "pending" && "bg-amber-100 text-amber-900",
                batch.prMeta.ciStatus === "red" && "bg-rose-100 text-rose-900",
              )}
            >
              CI {batch.prMeta.ciStatus ?? "—"}
            </span>
          </p>
        </section>
      )}

      {/* 포함된 피드백 */}
      <section className="rounded-xl border bg-card">
        <header className="border-b px-4 py-2 text-sm font-semibold">
          포함된 피드백 ({batch.acceptedFeedbacks.length})
        </header>
        <ul className="divide-y text-sm">
          {batch.acceptedFeedbacks.map((af) => {
            const audit = audits.find((a) => a.id === af.auditId);
            const f = feedback.find((x) => x.id === af.feedbackId);
            const conv = audit ? conversations[audit.conversationId] : null;
            return (
              <li key={`${af.auditId}::${af.feedbackId}`} className="px-4 py-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs">{af.feedbackId.slice(0, 12)}</span>
                  {audit && (
                    <Link
                      href={`/admin/inspection/${audit.id}`}
                      className="font-mono text-xs text-muted-foreground hover:underline"
                    >
                      {audit.id.slice(0, 14)}
                    </Link>
                  )}
                  {audit && <Badge variant="outline">{audit.auditorId}</Badge>}
                  {conv && (
                    <span className="text-xs text-muted-foreground">
                      {conv.topic.title}
                    </span>
                  )}
                </div>
                {f && <p className="mt-1 text-sm">{f.body}</p>}
              </li>
            );
          })}
        </ul>
      </section>

      {/* 액션 */}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <section className="rounded-xl border bg-card">
        <header className="border-b px-4 py-2 text-sm font-semibold">파이프라인 액션</header>
        <div className="flex flex-wrap gap-2 px-4 py-3">
          {batch.status === "queued" && (
            <>
              <Button
                onClick={() => run("submit", () => pipelineService.submitBatch(batch.id))}
                disabled={busy !== null}
              >
                {busy === "submit" ? "전송 중…" : "submit to pipeline"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => run("cancel", () => pipelineService.cancelBatch(batch.id))}
                disabled={busy !== null}
              >
                취소
              </Button>
            </>
          )}
          {batch.status === "in_pipeline" && (
            <>
              <Button
                onClick={() => run("merge", () => pipelineService.markMerged(batch.id))}
                disabled={busy !== null}
              >
                {busy === "merge" ? "머지 중…" : "mark merged (new ModelVersion 생성)"}
              </Button>
              <Button
                variant="destructive"
                onClick={() =>
                  run("fail", () =>
                    pipelineService.markFailed(batch.id, "데모: CI red 시뮬"),
                  )
                }
                disabled={busy !== null}
              >
                fail (mock)
              </Button>
            </>
          )}
          {batch.status === "merged" && batch.targetModelVersion && (
            <>
              <Button
                onClick={async () => {
                  await run("promote", () =>
                    pipelineService.promoteVersion(batch.targetModelVersion!),
                  );
                }}
                disabled={busy !== null}
              >
                {busy === "promote" ? "배포 중…" : "deploy (promote to production)"}
              </Button>
              <Button
                variant="ghost"
                render={
                  <Link
                    href={`/admin/pipeline/versions/${encodeURIComponent(batch.targetModelVersion)}`}
                  />
                }
              >
                ModelVersion 보기
              </Button>
            </>
          )}
          {batch.status === "deployed" && (
            <>
              <p className="text-sm text-muted-foreground">
                배포됨 — ModelVersion 페이지에서 롤백 가능합니다.
              </p>
              {batch.targetModelVersion && (
                <Button
                  variant="outline"
                  render={
                    <Link
                      href={`/admin/pipeline/versions/${encodeURIComponent(batch.targetModelVersion)}`}
                    />
                  }
                >
                  ModelVersion 보기
                </Button>
              )}
            </>
          )}
          {(batch.status === "cancelled" || batch.status === "pipeline_failed") && (
            <p className="text-sm text-muted-foreground">
              {batch.status === "cancelled" ? "취소된 batch 입니다." : "실패한 batch 입니다."}
              {batch.failureReason && ` 사유: ${batch.failureReason}`}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

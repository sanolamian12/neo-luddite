"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Rocket, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { usePipelineHydrated, usePipelineStore } from "@/lib/pipeline-store";
import { useAuditWorkStore } from "@/lib/audit-work-store";
import { formatDateTime } from "@/lib/poc-format";
import { cn, middleTruncate } from "@/lib/utils";
import * as pipelineService from "@/services/pipeline";
import type { VersionStatus } from "@/lib/poc-schema";

const STATUS_LABEL: Record<VersionStatus, string> = {
  candidate: "후보",
  production: "프로덕션",
  rolled_back: "롤백됨",
  superseded: "교체됨",
};
const STATUS_VARIANT: Record<VersionStatus, "default" | "secondary" | "outline" | "destructive"> = {
  candidate: "outline",
  production: "default",
  rolled_back: "destructive",
  superseded: "secondary",
};

export function VersionDetailView({ versionId }: { versionId: string }) {
  const router = useRouter();
  const hydrated = usePipelineHydrated();
  const versions = usePipelineStore((s) => s.versions);
  const batches = usePipelineStore((s) => s.batches);
  const audits = useAuditWorkStore((s) => s.audits);

  const version = useMemo(
    () => versions.find((v) => v.id === versionId) ?? null,
    [versions, versionId],
  );

  const [busy, setBusy] = useState<string | null>(null);
  const [rollbackReason, setRollbackReason] = useState("");
  const [showRollback, setShowRollback] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceBatches = useMemo(() => {
    if (!version) return [];
    return version.mergedFromBatchIds
      .map((id) => batches.find((b) => b.id === id))
      .filter((b): b is NonNullable<typeof b> => Boolean(b));
  }, [version, batches]);

  const contributors = useMemo(() => {
    if (!version) return [];
    const set = new Set<string>();
    for (const bid of version.mergedFromBatchIds) {
      const b = batches.find((x) => x.id === bid);
      if (!b) continue;
      for (const cid of b.contributorIds) set.add(cid);
    }
    return Array.from(set).sort();
  }, [version, batches]);

  if (!hydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }

  if (!version) {
    return (
      <div className="px-6 py-10">
        <h1 className="text-2xl font-bold">Version 을 찾을 수 없습니다</h1>
        <Link href="/admin/pipeline/versions" className="mt-2 inline-block text-sm underline">
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
      setShowRollback(false);
      setRollbackReason("");
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
          <h1 className="text-3xl font-bold font-mono tracking-tight">
            <span title={version.id}>{middleTruncate(version.id)}</span>
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={STATUS_VARIANT[version.status]}>{STATUS_LABEL[version.status]}</Badge>
            <span>생성 {formatDateTime(version.createdAt)}</span>
            {version.promotedAt && (
              <>
                <span>·</span>
                <span>승격 {formatDateTime(version.promotedAt)}</span>
              </>
            )}
            {version.retiredAt && (
              <>
                <span>·</span>
                <span>퇴역 {formatDateTime(version.retiredAt)}</span>
              </>
            )}
          </div>
          {version.notes && <p className="mt-2 text-sm">{version.notes}</p>}
        </div>
        <Link href="/admin/pipeline/versions" className="text-sm underline">
          ← 목록
        </Link>
      </header>

      {/* 메타 */}
      <section className="grid grid-cols-3 divide-x rounded-xl border bg-card">
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground">accuracy</p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums">
            {version.metrics?.accuracy !== undefined
              ? `${Math.round((version.metrics.accuracy ?? 0) * 1000) / 10}%`
              : "—"}
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground">coverage</p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums">
            {version.metrics?.coverage !== undefined
              ? `${Math.round((version.metrics.coverage ?? 0) * 1000) / 10}%`
              : "—"}
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground">source batches</p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums">
            {version.mergedFromBatchIds.length}
          </p>
        </div>
      </section>

      {/* PR */}
      {version.sourcePr && (
        <section className="rounded-xl border bg-card px-4 py-3">
          <h2 className="text-sm font-semibold">소스 PR</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            <a
              href={version.sourcePr.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              #{version.sourcePr.prNumber}
            </a>{" "}
            · branch {version.sourcePr.branch}
            {version.sourcePr.ciStatus && (
              <>
                {" · "}
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[10px]",
                    version.sourcePr.ciStatus === "green" && "bg-emerald-100 text-emerald-900",
                    version.sourcePr.ciStatus === "pending" && "bg-amber-100 text-amber-900",
                    version.sourcePr.ciStatus === "red" && "bg-rose-100 text-rose-900",
                  )}
                >
                  CI {version.sourcePr.ciStatus}
                </span>
              </>
            )}
          </p>
        </section>
      )}

      {/* Source batches */}
      <section className="rounded-xl border bg-card">
        <header className="border-b px-4 py-2 text-sm font-semibold">Source batches</header>
        <ul className="divide-y text-sm">
          {sourceBatches.length === 0 ? (
            <li className="px-4 py-3 text-muted-foreground">없음</li>
          ) : (
            sourceBatches.map((b) => (
              <li key={b.id} className="px-4 py-2">
                <Link
                  href={`/admin/pipeline/batches/${b.id}`}
                  className="font-mono text-xs hover:underline"
                  title={b.id}
                >
                  {middleTruncate(b.id)}
                </Link>
                <span className="ml-2 text-muted-foreground">{b.label}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  · {b.acceptedFeedbacks.length} feedback · {b.contributorIds.length}명
                </span>
              </li>
            ))
          )}
        </ul>
      </section>

      {/* Contributors */}
      {contributors.length > 0 && (
        <section className="rounded-xl border bg-card">
          <header className="border-b px-4 py-2 text-sm font-semibold">
            기여 평가자 ({contributors.length})
          </header>
          <ul className="divide-y text-sm">
            {contributors.map((id) => {
              const count = audits.filter((a) => a.auditorId === id).length;
              return (
                <li
                  key={id}
                  className="flex items-center justify-between px-4 py-2"
                >
                  <span className="font-mono text-xs" title={id}>{middleTruncate(id)}</span>
                  <span className="text-xs text-muted-foreground">
                    audit {count}건
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* 액션 */}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <section className="rounded-xl border bg-card">
        <header className="border-b px-4 py-2 text-sm font-semibold">액션</header>
        <div className="flex flex-wrap gap-2 px-4 py-3">
          {version.status === "candidate" && (
            <Button
              onClick={() => run("promote", () => pipelineService.promoteVersion(version.id))}
              disabled={busy !== null}
            >
              <Rocket className="size-3.5" />
              {busy === "promote" ? "배포 중…" : "프로덕션 승격"}
            </Button>
          )}
          {version.status === "production" && !showRollback && (
            <Button
              variant="destructive"
              onClick={() => setShowRollback(true)}
            >
              <RotateCcw className="size-3.5" />
              롤백
            </Button>
          )}
          {version.status === "production" && showRollback && (
            <div className="flex flex-col gap-2 w-full">
              <Textarea
                value={rollbackReason}
                onChange={(e) => setRollbackReason(e.target.value)}
                placeholder="롤백 사유 (필수)"
                rows={2}
              />
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  onClick={() =>
                    run("rollback", () =>
                      pipelineService.rollback(version.id, {
                        reason: rollbackReason.trim() || "사유 미입력",
                      }),
                    )
                  }
                  disabled={busy !== null || !rollbackReason.trim()}
                >
                  {busy === "rollback" ? "롤백 중…" : "롤백 실행"}
                </Button>
                <Button variant="ghost" onClick={() => setShowRollback(false)}>
                  취소
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                롤백 시 가장 최근 superseded 버전이 자동으로 production 으로 복귀합니다.
              </p>
            </div>
          )}
          {version.status === "rolled_back" && (
            <Button
              variant="outline"
              onClick={() => run("promote", () => pipelineService.promoteVersion(version.id))}
              disabled={busy !== null}
            >
              재승격
            </Button>
          )}
          {version.status === "superseded" && (
            <p className="text-sm text-muted-foreground">
              교체된 버전입니다. 직전 superseded 상태로 자동 복귀 가능.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

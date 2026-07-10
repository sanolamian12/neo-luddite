"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePipelineHydrated, usePipelineStore } from "@/lib/pipeline-store";
import { formatDateTime } from "@/lib/poc-format";
import { middleTruncate } from "@/lib/utils";
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

export function BatchListView() {
  const hydrated = usePipelineHydrated();
  const batches = usePipelineStore((s) => s.batches);

  const list = useMemo(
    () => [...batches].sort((a, b) => b.createdAt - a.createdAt),
    [batches],
  );

  if (!hydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Training Batch</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            인정 피드백을 묶은 학습 단위. PR / 머지 / 배포 시뮬.
          </p>
        </div>
        <Button render={<Link href="/admin/pipeline/batches/new" />}>새 Batch</Button>
      </header>

      <div className="rounded-xl border bg-card">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <Th>Batch ID</Th>
                <Th>라벨</Th>
                <Th className="text-right">피드백 수</Th>
                <Th className="text-right">평가자</Th>
                <Th>생성</Th>
                <Th>PR</Th>
                <Th>ModelVersion</Th>
                <Th>상태</Th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-muted-foreground">
                    생성된 batch 가 없습니다.{" "}
                    <Link href="/admin/pipeline/batches/new" className="underline">
                      새 Batch
                    </Link>
                  </td>
                </tr>
              ) : (
                list.map((b) => (
                  <tr key={b.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link href={`/admin/pipeline/batches/${b.id}`} className="hover:underline">
                        {b.id}
                      </Link>
                    </td>
                    <td className="px-3 py-2 max-w-[240px] truncate">{b.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.acceptedFeedbacks.length}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.contributorIds.length}</td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">
                      {formatDateTime(b.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {b.prMeta ? (
                        <a
                          href={b.prMeta.prUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                        >
                          #{b.prMeta.prNumber}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {b.targetModelVersion ? (
                        <Link
                          href={`/admin/pipeline/versions/${encodeURIComponent(b.targetModelVersion)}`}
                          className="font-mono underline"
                        >
                          {b.targetModelVersion}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={STATUS_VARIANT[b.status]}>{STATUS_LABEL[b.status]}</Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 모바일: 카드 리스트 */}
        {list.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground md:hidden">
            생성된 batch 가 없습니다.{" "}
            <Link href="/admin/pipeline/batches/new" className="underline">
              새 Batch
            </Link>
          </div>
        ) : (
          <ul className="divide-y md:hidden">
            {list.map((b) => (
              <li key={b.id} className="flex flex-col gap-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/admin/pipeline/batches/${b.id}`}
                    className="min-w-0 hover:underline"
                  >
                    <div className="truncate font-medium">{b.label}</div>
                    <span
                      title={b.id}
                      className="font-mono text-xs text-muted-foreground"
                    >
                      {middleTruncate(b.id)}
                    </span>
                  </Link>
                  <Badge variant={STATUS_VARIANT[b.status]}>{STATUS_LABEL[b.status]}</Badge>
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <div>
                    <dt className="inline">피드백 수 </dt>
                    <dd className="inline text-foreground tabular-nums">
                      {b.acceptedFeedbacks.length}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">평가자 </dt>
                    <dd className="inline text-foreground tabular-nums">
                      {b.contributorIds.length}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="inline">생성 </dt>
                    <dd className="inline text-foreground tabular-nums">
                      {formatDateTime(b.createdAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">PR </dt>
                    <dd className="inline text-foreground">
                      {b.prMeta ? (
                        <a
                          href={b.prMeta.prUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                        >
                          #{b.prMeta.prNumber}
                        </a>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">ModelVersion </dt>
                    <dd className="inline text-foreground">
                      {b.targetModelVersion ? (
                        <Link
                          href={`/admin/pipeline/versions/${encodeURIComponent(b.targetModelVersion)}`}
                          title={b.targetModelVersion}
                          className="font-mono underline"
                        >
                          {middleTruncate(b.targetModelVersion)}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-medium ${className ?? ""}`}>{children}</th>;
}

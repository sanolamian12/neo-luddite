"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePipelineHydrated, usePipelineStore } from "@/lib/pipeline-store";
import { formatDateTime } from "@/lib/poc-format";
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

      <div className="overflow-hidden rounded-xl border bg-card">
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
    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-medium ${className ?? ""}`}>{children}</th>;
}

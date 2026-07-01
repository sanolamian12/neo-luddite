"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { usePipelineHydrated, usePipelineStore } from "@/lib/pipeline-store";
import { formatDateTime } from "@/lib/poc-format";
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

export function VersionListView() {
  const hydrated = usePipelineHydrated();
  const versions = usePipelineStore((s) => s.versions);

  const list = useMemo(
    () => [...versions].sort((a, b) => b.createdAt - a.createdAt),
    [versions],
  );

  if (!hydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">ModelVersion</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          파이프라인을 거쳐 만들어진 모델 버전.
        </p>
      </header>

      <div className="overflow-hidden rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <Th>Version</Th>
              <Th>생성</Th>
              <Th>승격</Th>
              <Th className="text-right">batches</Th>
              <Th>metrics</Th>
              <Th>PR</Th>
              <Th>상태</Th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-muted-foreground">
                  발행된 버전이 없습니다.
                </td>
              </tr>
            ) : (
              list.map((v) => (
                <tr key={v.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono">
                    <Link
                      href={`/admin/pipeline/versions/${encodeURIComponent(v.id)}`}
                      className="font-medium hover:underline"
                    >
                      {v.id}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground text-xs">
                    {formatDateTime(v.createdAt)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground text-xs">
                    {v.promotedAt ? formatDateTime(v.promotedAt) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {v.mergedFromBatchIds.length}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {v.metrics?.accuracy !== undefined && (
                      <span className="mr-2">
                        acc {Math.round((v.metrics.accuracy ?? 0) * 1000) / 10}%
                      </span>
                    )}
                    {v.metrics?.coverage !== undefined && (
                      <span>cov {Math.round((v.metrics.coverage ?? 0) * 1000) / 10}%</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {v.sourcePr ? (
                      <a
                        href={v.sourcePr.prUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        #{v.sourcePr.prNumber}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={STATUS_VARIANT[v.status]}>{STATUS_LABEL[v.status]}</Badge>
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

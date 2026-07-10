"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useSettlementHydrated,
  useSettlementStore,
} from "@/lib/settlement-store";
import { formatDate, formatDateTime } from "@/lib/poc-format";
import { middleTruncate } from "@/lib/utils";

export function SettlementTable() {
  const hydrated = useSettlementHydrated();
  const rounds = useSettlementStore((s) => s.rounds);

  const list = useMemo(
    () =>
      [...rounds]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((r) => {
          const totalAccepted = r.allocations.reduce(
            (a, x) => a + x.acceptedCount,
            0,
          );
          const paidCount = r.allocations.filter((x) => x.paidAt != null).length;
          const fullyPaid =
            r.allocations.length > 0 && paidCount === r.allocations.length;
          return { r, totalAccepted, paidCount, fullyPaid };
        }),
    [rounds],
  );

  if (!hydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">정산 회차</h1>
        <Button render={<Link href="/admin/settlement/new" />}>새 회차</Button>
      </div>

      <div className="rounded-xl border bg-card">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <Th>회차</Th>
                <Th>대상 기간</Th>
                <Th className="text-right">참여 평가자</Th>
                <Th className="text-right">인정 합계</Th>
                <Th className="text-right">분배 pool</Th>
                <Th>분배 모델</Th>
                <Th>발행일</Th>
                <Th className="text-right">입금 현황</Th>
                <Th>상태</Th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-muted-foreground">
                    발행된 회차가 없습니다.{" "}
                    <Link href="/admin/settlement/new" className="underline">
                      새 회차
                    </Link>
                  </td>
                </tr>
              ) : (
                list.map(({ r, totalAccepted, paidCount, fullyPaid }) => (
                  <tr key={r.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">
                      <Link
                        href={`/admin/settlement/${encodeURIComponent(r.id)}`}
                        className="hover:underline"
                      >
                        {r.label}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {formatDate(r.periodFrom)} → {formatDate(r.periodTo)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.allocations.length}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {totalAccepted}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.pool.toLocaleString()} cr
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline">{r.distributionModel}</Badge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">
                      {formatDateTime(r.publishedAt)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Badge variant={fullyPaid ? "default" : "outline"}>
                        {paidCount}/{r.allocations.length} 입금
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        variant={r.status === "published" ? "default" : "secondary"}
                      >
                        {r.status === "published" ? "발행됨" : "초안"}
                      </Badge>
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
            발행된 회차가 없습니다.{" "}
            <Link href="/admin/settlement/new" className="underline">
              새 회차
            </Link>
          </div>
        ) : (
          <ul className="divide-y md:hidden">
            {list.map(({ r, totalAccepted, paidCount, fullyPaid }) => (
              <li key={r.id} className="flex flex-col gap-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/admin/settlement/${encodeURIComponent(r.id)}`}
                    className="min-w-0 hover:underline"
                  >
                    <div className="truncate font-medium">{r.label}</div>
                    <span
                      title={r.id}
                      className="font-mono text-xs text-muted-foreground"
                    >
                      {middleTruncate(r.id)}
                    </span>
                  </Link>
                  <Badge variant={r.status === "published" ? "default" : "secondary"}>
                    {r.status === "published" ? "발행됨" : "초안"}
                  </Badge>
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <div className="col-span-2">
                    <dt className="inline">대상 기간 </dt>
                    <dd className="inline text-foreground tabular-nums">
                      {formatDate(r.periodFrom)} → {formatDate(r.periodTo)}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">참여 평가자 </dt>
                    <dd className="inline text-foreground tabular-nums">
                      {r.allocations.length}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">인정 합계 </dt>
                    <dd className="inline text-foreground tabular-nums">{totalAccepted}</dd>
                  </div>
                  <div>
                    <dt className="inline">분배 pool </dt>
                    <dd className="inline text-foreground tabular-nums">
                      {r.pool.toLocaleString()} cr
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">분배 모델 </dt>
                    <dd className="inline text-foreground">{r.distributionModel}</dd>
                  </div>
                  <div>
                    <dt className="inline">발행일 </dt>
                    <dd className="inline text-foreground tabular-nums">
                      {formatDateTime(r.publishedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">입금 </dt>
                    <dd className="inline text-foreground tabular-nums">
                      {paidCount}/{r.allocations.length}
                      {fullyPaid ? " (완료)" : ""}
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

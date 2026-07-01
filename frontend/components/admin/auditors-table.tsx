"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useAuditorRegistryHydrated,
  useAuditorRegistryStore,
} from "@/lib/auditor-registry-store";
import { useAuditWorkHydrated, useAuditWorkStore } from "@/lib/audit-work-store";
import { useLedgerHydrated, useLedgerStore } from "@/lib/ledger-store";
import { formatDate } from "@/lib/poc-format";
import * as auditorService from "@/services/auditor";
import type { AuditorStatus, AuditorEntry } from "@/lib/poc-schema";

const STATUS_LABEL: Record<AuditorStatus, string> = {
  active: "활성",
  suspended: "정지",
};
const STATUS_VARIANT: Record<AuditorStatus, "default" | "secondary" | "outline"> = {
  active: "default",
  suspended: "outline",
};

export function AuditorsTable() {
  const regHydrated = useAuditorRegistryHydrated();
  const workHydrated = useAuditWorkHydrated();
  const ledgerHydrated = useLedgerHydrated();
  const auditors = useAuditorRegistryStore((s) => s.auditors);
  const audits = useAuditWorkStore((s) => s.audits);
  const ledger = useLedgerStore((s) => s.entries);
  const [filter, setFilter] = useState<AuditorStatus | "all">("all");
  const [q, setQ] = useState("");

  const enriched = useMemo(() => {
    if (!regHydrated) return [];
    return auditors
      .filter((a) => filter === "all" || a.status === filter)
      .filter((a) => {
        if (!q.trim()) return true;
        const needle = q.trim().toLowerCase();
        return (
          a.id.toLowerCase().includes(needle) ||
          a.displayName.toLowerCase().includes(needle) ||
          a.email.toLowerCase().includes(needle)
        );
      })
      .map((a) => {
        const myAudits = audits.filter((x) => x.auditorId === a.id);
        const myLedger = ledger.filter((e) => e.auditorId === a.id);
        let acc = 0;
        let rej = 0;
        const seen = new Set<string>();
        for (const e of myLedger) {
          if (e.sourceRef.kind === "audit" && !seen.has(e.sourceRef.auditId)) {
            seen.add(e.sourceRef.auditId);
            acc += e.sourceRef.acceptedCount;
            rej += e.sourceRef.rejectedCount;
          }
        }
        const totalCredit =
          myLedger
            .slice()
            .sort((x, y) => y.timestamp - x.timestamp)[0]?.balanceAfter ?? 0;
        const lastActivity = Math.max(
          0,
          ...myAudits.map((x) => x.submittedAt ?? x.pickedAt),
          ...myLedger.map((e) => e.timestamp),
        );
        const acceptanceRate = acc + rej === 0 ? null : acc / (acc + rej);
        return {
          auditor: a,
          totalAudits: myAudits.length,
          acceptedFeedbacks: acc,
          rejectedFeedbacks: rej,
          acceptanceRate,
          totalCredit,
          lastActivity: lastActivity > 0 ? lastActivity : null,
        };
      })
      .sort((a, b) => {
        // active 먼저
        if (a.auditor.status !== b.auditor.status)
          return a.auditor.status === "active" ? -1 : 1;
        return b.auditor.createdAt - a.auditor.createdAt;
      });
  }, [regHydrated, auditors, audits, ledger, filter, q]);

  const onToggleStatus = async (a: AuditorEntry) => {
    if (a.status === "active") await auditorService.suspend(a.id);
    else await auditorService.resume(a.id);
  };

  if (!regHydrated || !workHydrated || !ledgerHydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">평가자 관리</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            등록된 평가자 {auditors.length}명 · 표시 {enriched.length}명
          </p>
        </div>
        <Button render={<Link href="/admin/auditors/new" />}>새 평가자 등록</Button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={filter === "all" ? "default" : "outline"}
          onClick={() => setFilter("all")}
        >
          전체
        </Button>
        <Button
          size="sm"
          variant={filter === "active" ? "default" : "outline"}
          onClick={() => setFilter("active")}
        >
          활성
        </Button>
        <Button
          size="sm"
          variant={filter === "suspended" ? "default" : "outline"}
          onClick={() => setFilter("suspended")}
        >
          정지
        </Button>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="이름·이메일·ID 검색"
          className="ml-2 h-8 rounded-md border bg-background px-2 text-sm outline-none focus:border-foreground"
        />
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <Th>평가자</Th>
              <Th>연락처</Th>
              <Th>등록일</Th>
              <Th>최근 활동</Th>
              <Th className="text-right">누적 Audit</Th>
              <Th className="text-right">인정률</Th>
              <Th className="text-right">크레딧</Th>
              <Th>상태</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {enriched.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-12 text-center text-muted-foreground">
                  표시할 평가자가 없습니다.
                </td>
              </tr>
            ) : (
              enriched.map(
                ({
                  auditor,
                  totalAudits,
                  acceptanceRate,
                  totalCredit,
                  lastActivity,
                }) => (
                  <tr key={auditor.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <Link
                        href={`/admin/auditors/${encodeURIComponent(auditor.id)}`}
                        className="block hover:underline"
                      >
                        <div className="font-medium">{auditor.displayName}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {auditor.id}
                        </div>
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      <div>{auditor.email}</div>
                      {auditor.phone && <div>{auditor.phone}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {formatDate(auditor.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {lastActivity ? formatDate(lastActivity) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{totalAudits}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {acceptanceRate === null
                        ? "—"
                        : `${Math.round(acceptanceRate * 100)}%`}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {totalCredit} cr
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={STATUS_VARIANT[auditor.status]}>
                        {STATUS_LABEL[auditor.status]}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          render={
                            <Link
                              href={`/admin/auditors/${encodeURIComponent(auditor.id)}`}
                            />
                          }
                        >
                          상세
                        </Button>
                        <Button
                          size="sm"
                          variant={
                            auditor.status === "active" ? "ghost" : "outline"
                          }
                          onClick={() => onToggleStatus(auditor)}
                        >
                          {auditor.status === "active" ? "정지" : "복구"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ),
              )
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

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { LoadingBlock } from "@/components/ui/spinner";
import { useAuditorRegistryStore } from "@/lib/auditor-registry-store";
import { useConversationStore } from "@/lib/conversation-store";
import { getOccupation } from "@/lib/occupations";
import { formatDateTime } from "@/lib/poc-format";
import type { AdminPoolConsent, PoolCaseView } from "@/lib/poc-schema";
import { cn, middleTruncate } from "@/lib/utils";
import { MaskReportChips, PoolConsentBadge } from "@/components/case-pool/pool-parts";
import { errorMessage } from "./consultation-parts";
import * as casePool from "@/services/case-pool";
import { ConfirmAction, EmptyRow, OpsCard, OpsMeta, StatTile } from "./admin-ops-parts";

/**
 * 관리자 "풀 동의·열람" 탭 (§4.3) — 비식별 풀 동의(0037)의 집계·강제 철회와 열람 기록.
 *
 * 두 테이블 다 **Realtime publication 에 없다** — 이 화면이 직접 당긴다(새 채널 0개, 탭을 열 때만).
 * 강제 철회는 `revoke_pool_consent`(admin 허용): 마스킹 사본을 비우고 풀에서 즉시 내린다.
 * 이미 열린 방은 그대로다(D4) — 대화 중인 상대를 끊지 않는다.
 *
 * 열람 기록은 사용자 결정(2026-09-21)대로 **관리자만** 본다. 보기 단위는 사례별·세무사별 둘 다
 * (2026-09-23 결정): 사례별은 "이 사례가 누구에게 열렸나"(유출 추적), 세무사별은 "이 세무사가 얼마나
 * 뒤지나"(과열람 감시) — 같은 데이터의 두 집계다.
 */

type ViewMode = "case" | "auditor";

export function AdminPoolPanel() {
  const [consents, setConsents] = useState<AdminPoolConsent[] | null>(null);
  const [views, setViews] = useState<PoolCaseView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>("case");

  const records = useConversationStore((s) => s.records);
  const auditors = useAuditorRegistryStore((s) => s.auditors);

  // 두 테이블은 Realtime 이 아니라 직접 당긴다 — 탭을 열 때 한 번, 강제 철회 뒤 한 번 더.
  const load = useCallback(async () => {
    try {
      const [c, v] = await Promise.all([casePool.listAllConsents(), casePool.listCaseViews()]);
      setConsents(c);
      setViews(v);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, "풀 기록을 불러오지 못했습니다."));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([casePool.listAllConsents(), casePool.listCaseViews()])
      .then(([c, v]) => {
        if (!alive) return;
        setConsents(c);
        setViews(v);
        setError(null);
      })
      .catch((e: unknown) => {
        if (alive) setError(errorMessage(e, "풀 기록을 불러오지 못했습니다."));
      });
    return () => {
      alive = false;
    };
  }, []);

  const auditorName = (id: string) => auditors.find((a) => a.id === id)?.displayName ?? id;
  // 사장님 표시도 이름 우선(§(c) — 적재 전이 아니면 id 를 비추지 않는다).
  const ownerName = (c: AdminPoolConsent) =>
    records.find((r) => r.id === c.conversationId)?.ownerLabel || c.viewerId;
  const caseLabel = useCallback(
    (conversationId: string, consent?: AdminPoolConsent) =>
      consent?.title ??
      records.find((c) => c.id === conversationId)?.title ??
      `대화 ${middleTruncate(conversationId, 6, 4)}`,
    [records],
  );

  // 상태(공개 중·만료·철회)는 한 번만 판정해 두고 집계·목록이 같은 값을 쓴다.
  const rows = useMemo(
    () => (consents ?? []).map((c) => ({ consent: c, state: casePool.consentState(c) })),
    [consents],
  );
  const activeCount = rows.filter((r) => r.state === "active").length;
  const viewsByCase = useMemo(() => {
    const m = new Map<string, PoolCaseView[]>();
    for (const v of views ?? []) {
      const arr = m.get(v.conversationId) ?? [];
      arr.push(v);
      m.set(v.conversationId, arr);
    }
    return m;
  }, [views]);
  const byAuditor = useMemo(() => {
    const m = new Map<string, { cases: number; count: number; last: number }>();
    for (const v of views ?? []) {
      const cur = m.get(v.auditorId) ?? { cases: 0, count: 0, last: 0 };
      m.set(v.auditorId, {
        cases: cur.cases + 1,
        count: cur.count + v.viewCount,
        last: Math.max(cur.last, v.lastViewedAt),
      });
    }
    return [...m.entries()].sort((a, b) => b[1].last - a[1].last);
  }, [views]);

  if (error) {
    return (
      <div className="px-4 py-6 md:px-6">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => void load()}>
          다시 시도
        </Button>
      </div>
    );
  }
  if (!consents || !views) return <LoadingBlock label="불러오는 중…" />;

  const totalViews = views.reduce((sum, v) => sum + v.viewCount, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-4 py-4 md:px-6">
        <p className="text-xs text-muted-foreground break-keep">
          사장님이 대화를 비식별 사본으로 풀에 올린 동의(7일)와, 그 사례를 연 세무사 기록입니다.
          강제 철회하면 사본을 지우고 풀에서 즉시 내리지만 <strong>이미 열린 채팅방은 유지</strong>됩니다.
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          <StatTile label="동의 전체" value={consents.length} testId="pool-stat-all" />
          <StatTile label="공개 중" value={activeCount} testId="pool-stat-active" />
          <StatTile label="열람한 사례" value={viewsByCase.size} testId="pool-stat-viewed" />
          <StatTile label="열람 합계" value={totalViews} testId="pool-stat-views" />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section>
          <h2 className="px-4 pt-4 pb-1 text-sm font-semibold md:px-6">풀 동의</h2>
          {consents.length === 0 ? (
            <EmptyRow>아직 풀에 올라온 사례가 없습니다.</EmptyRow>
          ) : (
            <ul data-testid="admin-consent-list">
              {rows.map(({ consent: c, state }) => {
                const seen = viewsByCase.get(c.conversationId) ?? [];
                return (
                  <OpsCard key={c.conversationId} testId="admin-consent-row">
                    <div className="flex flex-wrap items-center gap-2">
                      <PoolConsentBadge state={state} />
                      <span className="text-sm font-medium break-keep">
                        {caseLabel(c.conversationId, c)}
                      </span>
                    </div>
                    <OpsMeta
                      items={[
                        ["사장님", ownerName(c)],
                        ["업종", (c.occupation ? getOccupation(c.occupation)?.label : null) ?? c.occupation ?? "—"],
                        ["세목", c.taxCategory ?? "—"],
                        ["동의", formatDateTime(c.grantedAt)],
                        ["만료", formatDateTime(c.expiresAt)],
                        ...(c.revokedAt
                          ? ([["철회", formatDateTime(c.revokedAt)]] as Array<[string, string]>)
                          : []),
                        [
                          "열람",
                          seen.length === 0
                            ? "없음"
                            : seen
                                .map((v) => `${auditorName(v.auditorId)} ${v.viewCount}회`)
                                .join(" · "),
                        ],
                      ]}
                    />
                    <MaskReportChips report={c.maskReport} />
                    {state === "active" ? (
                      <ConfirmAction
                        label="동의 강제 철회"
                        confirmLabel="철회합니다"
                        warning="이 사례를 풀에서 즉시 내리고 마스킹 사본을 지웁니다. 세무사는 더 볼 수 없고 새 연결 요청도 못 겁니다. 사장님이 직접 철회한 것과 같으며(운영자가 했다는 표시는 없습니다), 되돌리려면 사장님이 다시 동의해야 합니다. 이미 열린 채팅방은 그대로 유지됩니다."
                        testId="admin-consent-revoke"
                        onConfirm={async () => {
                          await casePool.revoke(c.conversationId);
                          await load();
                        }}
                      />
                    ) : null}
                  </OpsCard>
                );
              })}
            </ul>
          )}
        </section>

        <section className="border-t">
          <div className="flex flex-wrap items-center gap-2 px-4 pt-4 pb-2 md:px-6">
            <h2 className="text-sm font-semibold">풀 열람 기록</h2>
            <div className="flex gap-1" role="group" aria-label="열람 기록 보기 단위">
              {(
                [
                  ["case", "사례별"],
                  ["auditor", "세무사별"],
                ] as Array<[ViewMode, string]>
              ).map(([m, label]) => (
                <Button
                  key={m}
                  variant="outline"
                  size="sm"
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                  data-testid={`pool-views-${m}`}
                  className={cn("h-7 px-2 text-xs", mode === m && "border-primary bg-primary/5")}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          {views.length === 0 ? (
            <EmptyRow>아직 풀 사례를 연 세무사가 없습니다.</EmptyRow>
          ) : mode === "case" ? (
            <ul data-testid="admin-views-by-case">
              {[...viewsByCase.entries()]
                .sort(
                  (a, b) =>
                    Math.max(...b[1].map((v) => v.lastViewedAt)) -
                    Math.max(...a[1].map((v) => v.lastViewedAt)),
                )
                .map(([conversationId, rows]) => (
                  <OpsCard key={conversationId} testId="admin-view-case-row">
                    <p className="text-sm font-medium break-keep">
                      {caseLabel(
                        conversationId,
                        consents.find((c) => c.conversationId === conversationId),
                      )}
                    </p>
                    <ul className="flex flex-col gap-1">
                      {[...rows]
                        .sort((a, b) => b.lastViewedAt - a.lastViewedAt)
                        .map((v) => (
                          <li key={v.auditorId} className="text-xs" data-testid="admin-view-entry">
                            <span className="font-medium text-foreground">
                              {auditorName(v.auditorId)}
                            </span>{" "}
                            <span className="text-muted-foreground">
                              {v.viewCount}회 · 처음 {formatDateTime(v.firstViewedAt)} · 마지막{" "}
                              {formatDateTime(v.lastViewedAt)}
                            </span>
                          </li>
                        ))}
                    </ul>
                  </OpsCard>
                ))}
            </ul>
          ) : (
            <ul data-testid="admin-views-by-auditor">
              {byAuditor.map(([auditorId, s]) => (
                <OpsCard key={auditorId} testId="admin-view-auditor-row">
                  <p className="text-sm font-medium break-keep">{auditorName(auditorId)}</p>
                  <OpsMeta
                    items={[
                      ["사례", `${s.cases}건`],
                      ["열람", `${s.count}회`],
                      ["마지막", formatDateTime(s.last)],
                    ]}
                  />
                </OpsCard>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

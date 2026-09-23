"use client";

import { useMemo, useState } from "react";
import { useAuditorRegistryStore } from "@/lib/auditor-registry-store";
import { useConversationStore } from "@/lib/conversation-store";
import { effectiveOfferStatus, useOfferHydrated, useOfferStore } from "@/lib/offer-store";
import type { ConsultationOffer, OfferStatus } from "@/lib/poc-schema";
import { formatDateTime } from "@/lib/poc-format";
import { middleTruncate } from "@/lib/utils";
import { LoadingBlock } from "@/components/ui/spinner";
import { OFFER_STATUS_LABEL, OfferStatusBadge } from "@/components/offer/offer-parts";
import * as offerService from "@/services/offer";
import { ConfirmAction, EmptyRow, OpsCard, OpsMeta, StatTile } from "./admin-ops-parts";

/**
 * 관리자 "제안" 탭 (§4.3) — 경로 B 연결 요청(0039)의 상태별 집계와 브레이크.
 *
 * 읽기는 `consultation_offers_admin_read`(전체), 스토어는 `lib/offer-store` 를 그대로 쓴다
 * (이 컬렉션은 계정 버튼 뱃지 때문에 이미 첫 화면부터 붙어 있다 — 이 탭이 새 채널을 만들지 않는다).
 * 브레이크는 `transition_offer` — **admin 은 거절·철회만**이고 승인은 없다(사장님 대신 방을 열지 않는다, §5).
 */

const STATUS_ORDER: OfferStatus[] = ["pending", "approved", "declined", "withdrawn", "expired"];

export function AdminOffersPanel() {
  const hydrated = useOfferHydrated();
  const offers = useOfferStore((s) => s.offers);
  const records = useConversationStore((s) => s.records);
  const auditors = useAuditorRegistryStore((s) => s.auditors);
  const [status, setStatus] = useState<OfferStatus | "all">("all");

  // 만료는 pg_cron 없이 읽을 때 판정한다(0039) — 집계도 화면과 같은 기준으로 센다.
  const withStatus = useMemo(
    () =>
      [...offers]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((o) => ({ offer: o, status: effectiveOfferStatus(o) })),
    [offers],
  );
  const counts = useMemo(() => {
    const c = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<OfferStatus, number>;
    for (const { status: s } of withStatus) c[s] += 1;
    return c;
  }, [withStatus]);
  const list = useMemo(
    () => (status === "all" ? withStatus : withStatus.filter((x) => x.status === status)),
    [withStatus, status],
  );

  const expertName = (id: string) => auditors.find((a) => a.id === id)?.displayName ?? id;
  const convOf = (o: ConsultationOffer) => records.find((c) => c.id === o.conversationId);
  const ownerName = (o: ConsultationOffer) => convOf(o)?.ownerLabel || o.viewerId;

  if (!hydrated) return <LoadingBlock label="불러오는 중…" />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-4 py-4 md:px-6">
        <p className="text-xs text-muted-foreground break-keep">
          세무사가 비식별 풀에서 사장님에게 건 연결 요청(경로 B). 승인·거절은 사장님이 합니다 —
          운영자는 대기 중인 요청을 <strong>거절·철회</strong>만 할 수 있습니다.
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
          <StatTile
            label="전체"
            value={withStatus.length}
            active={status === "all"}
            onClick={() => setStatus("all")}
            testId="offer-stat-all"
          />
          {STATUS_ORDER.map((s) => (
            <StatTile
              key={s}
              label={OFFER_STATUS_LABEL[s]}
              value={counts[s]}
              active={status === s}
              warn={s === "pending" && counts[s] > 0}
              onClick={() => setStatus(s)}
              testId={`offer-stat-${s}`}
            />
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.length === 0 ? (
          <EmptyRow>
            {withStatus.length === 0 ? "아직 연결 요청이 없습니다." : "해당하는 요청이 없습니다."}
          </EmptyRow>
        ) : (
          <ul data-testid="admin-offer-list">
            {list.map(({ offer, status: eff }) => (
              <OpsCard key={offer.id} testId="admin-offer-row">
                <div className="flex flex-wrap items-center gap-2">
                  <OfferStatusBadge status={eff} />
                  <span className="text-sm font-medium break-keep">
                    {expertName(offer.expertId)} → {ownerName(offer)}
                  </span>
                </div>
                <p className="text-sm break-keep">
                  {convOf(offer)?.title ?? `대화 ${middleTruncate(offer.conversationId, 6, 4)}`}
                </p>
                {offer.message ? (
                  <p className="rounded-md bg-muted px-2 py-1 text-xs break-keep">{offer.message}</p>
                ) : null}
                <OpsMeta
                  items={[
                    ["요청", formatDateTime(offer.createdAt)],
                    ["만료", formatDateTime(offer.expiresAt)],
                    ["대화", middleTruncate(offer.conversationId, 6, 4)],
                  ]}
                />
                {eff === "pending" ? (
                  <div className="flex flex-wrap gap-2">
                    <ConfirmAction
                      label="거절 처리"
                      confirmLabel="거절합니다"
                      warning="이 요청을 사장님 대신 거절합니다. 세무사에게는 사장님이 거절한 것과 같은 메일이 가고(운영자가 했다는 표시는 없습니다), 사례당 1회라 같은 세무사는 이 대화에 다시 요청할 수 없습니다. 되돌릴 수 없습니다."
                      testId="admin-offer-decline"
                      onConfirm={async () => {
                        await offerService.decline(offer.id);
                      }}
                    />
                    <ConfirmAction
                      label="철회 처리"
                      confirmLabel="철회합니다"
                      warning="이 요청을 세무사 대신 철회합니다. 사장님에게는 세무사가 철회한 것과 같은 알림이 가고(운영자가 했다는 표시는 없습니다), 사례당 1회라 같은 세무사는 이 대화에 다시 요청할 수 없습니다. 되돌릴 수 없습니다."
                      testId="admin-offer-withdraw"
                      onConfirm={async () => {
                        await offerService.withdraw(offer.id);
                      }}
                    />
                  </div>
                ) : null}
              </OpsCard>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

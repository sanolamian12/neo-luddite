"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, UserRound } from "lucide-react";
import type { UiBlock } from "@/lib/conversation-schema";
import type { ExpertCard } from "@/lib/poc-schema";
import { useAccountStore } from "@/lib/account-store";
import { useRemoteChatStore } from "@/lib/runtime/remote-chat-store";
import { useConsultationStore } from "@/lib/consultation-store";
import type { ConsultationStatus } from "@/lib/poc-schema";
import * as expertService from "@/services/expert";
import * as consultationService from "@/services/consultation";
import * as casePool from "@/services/case-pool";
import { MaskPreview, OWNER_POOL_NOTICE } from "@/components/case-pool/pool-parts";
import { ExpertAvatar, ExpertCardView } from "@/components/expert/expert-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverPositioner,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/**
 * 세무사 연결 카드 (uiBlock kind="expert_handoff").
 * 티저(얼굴 3 + 인원) → 팝오버(카드 목록·하트·선택) → 시트(메시지) → 신청 완료.
 * 명단은 블록에 없다 — 렌더 시점에 list_experts() 로 조회(명단이 바뀌어도 옛 대화가 안 낡음).
 * 원본: credigraph prototype expert-handoff-block.tsx — 대본 재생 대신 라이브 대화 id 로 연결.
 */

function ExpertTeaser({
  experts,
  selectedId,
  onSelect,
  onRequest,
  onToggleLike,
  likeBusyId,
  canAct,
}: {
  experts: ExpertCard[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRequest: () => void;
  onToggleLike: (id: string) => void;
  likeBusyId: string | null;
  canAct: boolean;
}) {
  const [open, setOpen] = useState(false);
  const preview = experts.slice(0, 3);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex -space-x-3">
        {preview.map((e) => (
          <ExpertAvatar
            key={e.auditorId}
            expert={e}
            className="size-9 border-2 border-background text-xs"
          />
        ))}
      </div>
      <p className="min-w-[9rem] flex-1 break-keep text-sm text-muted-foreground">
        {experts.length}명의 세무사가 상담 가능합니다
      </p>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={<Button variant="outline" size="sm" className="w-full sm:w-auto" />}>
          세무사 보기
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverPositioner side="bottom" align="end" sideOffset={8} collisionPadding={16}>
            {/* 남은 화면 높이(--available-height)에 맞춰 목록만 스크롤 — 모바일에서도 [상담 신청]이 안 잘린다. */}
            <PopoverContent className="flex max-h-[min(560px,var(--available-height))] w-[min(380px,calc(100vw-2rem))] flex-col p-0">
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
                {experts.map((e) => (
                  <ExpertCardView
                    key={e.auditorId}
                    expert={e}
                    selected={selectedId === e.auditorId}
                    onSelect={() => onSelect(e.auditorId)}
                    onToggleLike={canAct ? () => onToggleLike(e.auditorId) : undefined}
                    likeBusy={likeBusyId === e.auditorId}
                  />
                ))}
              </div>
              <div className="shrink-0 border-t p-3">
                <Button
                  className="w-full"
                  disabled={!selectedId || !canAct}
                  onClick={() => {
                    setOpen(false);
                    onRequest();
                  }}
                >
                  상담 신청
                </Button>
              </div>
            </PopoverContent>
          </PopoverPositioner>
        </PopoverPortal>
      </Popover>
    </div>
  );
}

export function ExpertHandoffBlock({
  block,
}: {
  block: Extract<UiBlock, { kind: "expert_handoff" }>;
}) {
  const conversationId = useRemoteChatStore((s) => s.conversationId);
  const viewerId = useAccountStore((s) => s.viewer.id);
  const [experts, setExperts] = useState<ExpertCard[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [likeBusyId, setLikeBusyId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submittedTo, setSubmittedTo] = useState<ExpertCard | null>(null);
  const [alreadyRequested, setAlreadyRequested] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [restoredStatus, setRestoredStatus] = useState<ConsultationStatus | null>(null);
  // 신청 뒤 상태는 Realtime 스토어에서 따라간다(세무사가 수락·완료하면 카드 문구가 바뀐다).
  const liveStatus = useConsultationStore(
    (s) => (requestId ? s.requests.find((r) => r.id === requestId)?.status : undefined),
  );
  const [error, setError] = useState<string | null>(null);
  // 상담사 풀 노출 동의 — 선택(기본 꺼짐). 동의하지 않아도 신청은 그대로 간다(설계 §1).
  const [poolOptIn, setPoolOptIn] = useState(false);
  const [showPoolPreview, setShowPoolPreview] = useState(false);
  const [poolResult, setPoolResult] = useState<"granted" | "failed" | null>(null);

  // 하트·신청은 라이브 대화에 묶인다(세션당 하트 1회). 재생 모드에선 보기만.
  const canAct = Boolean(conversationId);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let active = true;
    // 이 대화에서 이미 신청했다면(대화 재진입) 목록 대신 "신청 완료"로 복원 — 중복 신청 방지.
    Promise.all([
      expertService.listExperts(conversationId),
      conversationId
        ? consultationService.findActiveForConversation(conversationId)
        : Promise.resolve(null),
    ])
      .then(([items, existing]) => {
        if (!active) return;
        setExperts(items);
        setLoadError(null);
        if (existing) {
          setSubmittedTo(items.find((e) => e.auditorId === existing.expertId) ?? null);
          setAlreadyRequested(true);
          setRequestId(existing.id);
          setRestoredStatus(existing.status as ConsultationStatus);
        }
      })
      .catch((e: unknown) => {
        if (active) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [conversationId, reloadKey]);

  const handleToggleLike = async (expertId: string) => {
    if (!conversationId || likeBusyId) return;
    setLikeBusyId(expertId);
    // 낙관적 반영 → 서버 값으로 확정
    setExperts((list) =>
      list?.map((e) =>
        e.auditorId === expertId
          ? {
              ...e,
              likedByMe: !e.likedByMe,
              likeCount: Math.max(0, e.likeCount + (e.likedByMe ? -1 : 1)),
            }
          : e,
      ) ?? list,
    );
    try {
      const r = await expertService.toggleLike(expertId, conversationId);
      setExperts((list) =>
        list?.map((e) =>
          e.auditorId === expertId ? { ...e, likedByMe: r.liked, likeCount: r.likeCount } : e,
        ) ?? list,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      reload();
    } finally {
      setLikeBusyId(null);
    }
  };

  const selected = experts?.find((e) => e.auditorId === selectedId) ?? null;

  const handleSubmit = async () => {
    if (!selected || !conversationId) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await consultationService.request({
        conversationId,
        viewerId,
        expertId: selected.auditorId,
        message,
      });
      // 신청이 먼저다. 풀 동의가 실패해도 신청은 이미 간 것이므로 되돌리지 않는다.
      if (poolOptIn) {
        try {
          await casePool.grant(conversationId);
          setPoolResult("granted");
        } catch {
          setPoolResult("failed");
        }
      }
      setSubmittedTo(selected);
      setRequestId(created.id);
      setSheetOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (submittedTo || alreadyRequested) {
    const who = submittedTo ? `${submittedTo.displayName} 세무사에게` : "세무사에게";
    const status = liveStatus ?? restoredStatus ?? "pending";
    const next =
      status === "accepted"
        ? "세무사가 상담을 수락했습니다. 신청 현황에서 연락처를 확인하세요."
        : status === "completed"
          ? "세무사와의 상담이 완료되었습니다."
          : "세무사가 확인 후 연락드립니다.";
    return (
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex items-center gap-3 py-5">
          <CheckCircle2 className="size-8 shrink-0 text-primary" />
          <div>
            <p className="font-semibold">신청 완료</p>
            <p className="text-sm text-muted-foreground">
              {alreadyRequested
                ? `이 상담에서 이미 ${who} 상담을 신청했습니다.`
                : `${who} 상담을 신청했습니다.`}{" "}
              {next}
            </p>
            {poolResult === "granted" && (
              <p className="mt-1 text-xs text-muted-foreground">
                비식별 처리한 대화를 상담사 풀에도 올렸습니다({casePool.POOL_CONSENT_DAYS}일). 신청 현황에서 철회할 수
                있습니다.
              </p>
            )}
            {poolResult === "failed" && (
              <p className="mt-1 text-xs text-destructive">
                상담사 풀에는 올리지 못했습니다. 신청은 정상 접수되었습니다.
              </p>
            )}
            {requestId && (
              <Link
                href={`/consultations/${encodeURIComponent(requestId)}`}
                className="mt-1 inline-block text-sm font-medium text-primary underline-offset-2 hover:underline"
              >
                신청 현황 보기 →
              </Link>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <UserRound className="size-5 text-brand-amber" />
          <CardTitle className="text-base">세무사와 직접 상담해 보세요</CardTitle>
        </div>
        <p className="break-keep text-sm text-muted-foreground">{block.reason}</p>
        {block.note && (
          <p className="break-keep text-xs text-muted-foreground">{block.note}</p>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {loadError ? (
          <p className="text-sm text-destructive">세무사 목록을 불러오지 못했습니다.</p>
        ) : experts === null ? (
          <p className="text-sm text-muted-foreground">세무사 목록을 불러오는 중…</p>
        ) : experts.length === 0 ? (
          <p className="text-sm text-muted-foreground">현재 상담 가능한 세무사가 없습니다.</p>
        ) : (
          <ExpertTeaser
            experts={experts}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onRequest={() => setSheetOpen(true)}
            onToggleLike={handleToggleLike}
            likeBusyId={likeBusyId}
            canAct={canAct}
          />
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>상담 신청 확인</SheetTitle>
            <SheetDescription>
              {selected
                ? `${selected.displayName} 세무사에게 상담을 요청합니다. 추가로 전할 내용이 있으면 적어 주세요.`
                : "선택한 세무사에게 상담을 요청합니다."}
            </SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="px-4">
              <ExpertCardView expert={selected} />
            </div>
          )}
          <div className="flex flex-col gap-3 px-4">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="추가로 전달할 내용 (선택)"
              rows={4}
              aria-label="상담 신청 메시지"
            />
            <p className="text-xs text-muted-foreground">
              신청하면 이 AI 상담 내용이 세무사에게 함께 전달됩니다.
            </p>
            <div className="flex flex-col gap-2 rounded-xl border p-3">
              <label className="flex items-start gap-2 text-sm break-keep">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  checked={poolOptIn}
                  onChange={(e) => setPoolOptIn(e.target.checked)}
                  aria-label="상담사 풀 공개 동의"
                />
                <span>
                  이 대화를 비식별 처리해 상담사 풀에 올려도 됩니다
                  <span className="block text-xs text-muted-foreground">
                    선택 사항 · 고른 세무사 외 다른 세무사도 사례를 보고 연락을 제안할 수 있습니다
                  </span>
                </span>
              </label>
              <p className="text-[11px] break-keep text-muted-foreground">{OWNER_POOL_NOTICE}</p>
              <button
                type="button"
                className="w-fit text-xs font-medium text-primary underline-offset-2 hover:underline"
                onClick={() => setShowPoolPreview((v) => !v)}
                aria-expanded={showPoolPreview}
              >
                {showPoolPreview ? "미리보기 닫기" : "무엇이 가려지는지 보기"}
              </button>
              {showPoolPreview && conversationId && <MaskPreview conversationId={conversationId} />}
            </div>
          </div>
          <SheetFooter>
            <Button onClick={handleSubmit} disabled={submitting || !selected}>
              {submitting ? "신청 중…" : "신청하기"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </Card>
  );
}

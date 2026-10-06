"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/components/consultation/consultation-parts";
import { isPrototype } from "@/lib/data-mode";
import { ROOM_AGENT_WAIT_MS, type ConsultationRoom, type RoomMessage } from "@/lib/poc-schema";
import { useRoomStore } from "@/lib/room-store";
import * as roomService from "@/services/room";

/**
 * 3자 방 세무사 AI(0044) — 대기 표시 · 3분 타이머 · 다시 시도 · 상대 쪽 백업 호출 · 세무사 스위치.
 * 설계: design/세무사에이전트_3자방_설계.md §4·§5·§8. 호출 중복은 서버(room_agent_runs PK)가 막는다.
 */

/** 상대가 보낸 자격 메시지에 run 이 이만큼 안 생기면 내가 부른다(보낸 사람이 탭을 닫은 경우, D1). */
const BACKUP_AFTER_MS = 10_000;
/** 이보다 오래된 메시지는 백업하지 않는다 — 방을 열 때 옛 메시지(0044 이전 등)에 답이 달리지 않게. */
const BACKUP_WINDOW_MS = 60_000;

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function AgentStatusBar({ room, messages, me, isMember }: {
  room: ConsultationRoom;
  messages: RoomMessage[];
  me: string;
  isMember: boolean;
}) {
  const allRuns = useRoomStore((s) => s.runs);
  const runs = useMemo(() => allRuns.filter((r) => r.roomId === room.id), [allRuns, room.id]);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 백업은 메시지당 한 번 — 서버가 off(스위치 꺼짐)·busy 로 답하면 run 행이 안 생겨 매초 다시 부르게 된다.
  const backedUp = useRef(new Set<string>());

  // 마지막 자격 메시지와 그 뒤 agent 답이 있었나.
  const lastTrigger = useMemo(() => [...messages].reverse().find((m) => roomService.isAgentTrigger(room, m)), [messages, room]);
  const answeredAfter = Boolean(lastTrigger && messages.some((m) => m.senderRole === "agent" && m.createdAt > lastTrigger.createdAt));
  const running = runs.find((r) => r.status === "running");
  const lastRun = lastTrigger ? runs.find((r) => r.triggerMessageId === lastTrigger.id) : undefined;

  // 시계 — 도는 중이거나 백업 대기 중일 때만.
  const needClock = Boolean(running) || Boolean(lastTrigger && !lastRun && !answeredAfter);
  useEffect(() => {
    if (!needClock) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [needClock]);

  // 백업 호출: 상대가 보낸 최근 자격 메시지에 run 이 10초째 없으면.
  useEffect(() => {
    if (isPrototype || !isMember || !lastTrigger || lastRun || answeredAfter || lastTrigger.senderId === me) return;
    const age = now - lastTrigger.createdAt;
    if (age < BACKUP_AFTER_MS || age > BACKUP_WINDOW_MS || backedUp.current.has(lastTrigger.id)) return;
    backedUp.current.add(lastTrigger.id);
    void roomService.requestAgentReply(room.id, lastTrigger.id).catch(() => {});
  }, [now, isMember, lastTrigger, lastRun, answeredAfter, me, room.id]);

  const retry = async (triggerId: string) => {
    setBusy(true);
    setError(null);
    try {
      await roomService.requestAgentReply(room.id, triggerId, true);
    } catch (e) {
      setError(errorMessage(e, "다시 부르지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };

  let body: React.ReactNode = null;
  if (running) {
    const elapsed = now - running.startedAt;
    body = elapsed <= ROOM_AGENT_WAIT_MS ? (
      <span className="flex items-center gap-1.5" data-testid="agent-waiting">
        <Loader2 className="size-3.5 animate-spin" />
        세무사 AI 가 답을 쓰는 중… <span className="tabular-nums">{mmss(elapsed)} / {mmss(ROOM_AGENT_WAIT_MS)}</span>
      </span>
    ) : (
      <Stalled label="답이 늦어 멈췄습니다." onRetry={isMember ? () => retry(running.triggerMessageId) : undefined} busy={busy} />
    );
  } else if (lastTrigger && lastRun && !answeredAfter && (lastRun.status === "failed" || lastRun.status === "expired")) {
    body = (
      <Stalled
        label={lastRun.status === "expired" ? "답이 늦어 멈췄습니다." : lastRun.error === "congested" ? "지금 상담 AI 가 붐벼 답하지 못했습니다." : "답을 만들지 못했습니다."}
        onRetry={isMember ? () => retry(lastTrigger.id) : undefined}
        busy={busy}
      />
    );
  }
  if (!body && !error) return null;
  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-2 text-xs text-violet-700 md:px-6 dark:text-violet-300" role="status">
      {body}
      {error && <span className="text-destructive">{error}</span>}
    </div>
  );
}

function Stalled({ label, onRetry, busy }: { label: string; onRetry?: () => void; busy: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-2" data-testid="agent-stalled">
      <Bot className="size-3.5" />
      {label}
      {onRetry && (
        <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={busy} onClick={onRetry}>
          <RotateCcw className="size-3" />다시 시도
        </Button>
      )}
    </span>
  );
}

/** 방 머리 아래 한 줄 — 세무사: 스위치 2개(U1·U2) · 사장님: 상태 안내. */
export function AgentSwitchBar({ room, side, isMember }: { room: ConsultationRoom; side: "owner" | "expert"; isMember: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (isPrototype || room.status !== "open") return null;
  if (side === "owner") {
    return room.agentReplyCustomer ? (
      <p className="flex items-center gap-1.5 border-b bg-violet-50/60 px-4 py-1.5 text-[11px] text-violet-800 md:px-6 dark:bg-violet-950/30 dark:text-violet-200">
        <Bot className="size-3.5 shrink-0" />세무사 AI 가 먼저 답하고, 담당 세무사가 대화를 함께 봅니다. AI 답변은 참고용입니다.
      </p>
    ) : null;
  }
  if (!isMember) return null;
  const toggle = async (customer: boolean | null, expert: boolean | null) => {
    setBusy(true);
    setError(null);
    try {
      await roomService.setAgentSwitches(room.id, customer, expert);
    } catch (e) {
      setError(errorMessage(e, "바꾸지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-violet-50/60 px-4 py-1.5 text-xs md:px-6 dark:bg-violet-950/30" data-testid="agent-switches">
      <span className="flex items-center gap-1 font-medium text-violet-800 dark:text-violet-200"><Bot className="size-3.5" />내 AI</span>
      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={room.agentReplyCustomer} disabled={busy}
          onChange={(e) => void toggle(e.target.checked, null)} data-testid="agent-switch-customer" />
        고객에게 답하기
      </label>
      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={room.agentReplyExpert} disabled={busy}
          onChange={(e) => void toggle(null, e.target.checked)} data-testid="agent-switch-expert" />
        내 메시지에 답하기
      </label>
      {error && <span className="text-destructive">{error}</span>}
    </div>
  );
}

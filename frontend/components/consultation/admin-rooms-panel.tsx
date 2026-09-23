"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { LoadingBlock } from "@/components/ui/spinner";
import { useAuditorRegistryStore } from "@/lib/auditor-registry-store";
import { useConversationStore } from "@/lib/conversation-store";
import { formatDateTime } from "@/lib/poc-format";
import type { ConsultationRoom } from "@/lib/poc-schema";
import { sortRooms, useRoomStore, useRoomsHydrated } from "@/lib/room-store";
import { cn, middleTruncate } from "@/lib/utils";
import * as roomService from "@/services/room";
import { ConfirmAction, EmptyRow, OpsCard, OpsMeta, StatTile } from "./admin-ops-parts";

/**
 * 관리자 "채팅방" 탭 (§4.3) — 방(0038)의 열림·닫힘 집계와 강제 종료.
 *
 * **대화 내용은 그리지 않는다**(사용자 결정 2026-09-23: 집계만). RLS 는 admin 에게 메시지 읽기를
 * 열어 두었지만(`consultation_messages_admin_read`), 사장님·세무사 사이 사적 대화라 화면에서는
 * 건수와 마지막 시각까지만 쓴다. 분쟁 대응이 필요해지면 그때 따로 설계한다.
 *
 * 스토어는 `lib/room-store`(사이드바 뱃지 때문에 이미 첫 화면부터 붙어 있다 — 새 채널 없음).
 */

const ORIGIN_LABEL: Record<ConsultationRoom["origin"], string> = {
  request: "경로 A · 신청 수락",
  offer: "경로 B · 요청 승인",
};

export function AdminRoomsPanel() {
  const hydrated = useRoomsHydrated();
  const rooms = useRoomStore((s) => s.rooms);
  const messages = useRoomStore((s) => s.messages);
  const records = useConversationStore((s) => s.records);
  const auditors = useAuditorRegistryStore((s) => s.auditors);
  const [filter, setFilter] = useState<"all" | "open" | "closed">("all");

  const messageCount = useMemo(() => {
    const byRoom = new Map<string, number>();
    for (const m of messages) {
      if (m.deletedAt) continue;
      byRoom.set(m.roomId, (byRoom.get(m.roomId) ?? 0) + 1);
    }
    return byRoom;
  }, [messages]);

  const all = useMemo(() => sortRooms(rooms), [rooms]);
  const openCount = all.filter((r) => r.status === "open").length;
  const list = useMemo(
    () => (filter === "all" ? all : all.filter((r) => r.status === filter)),
    [all, filter],
  );
  const totalMessages = useMemo(
    () => [...messageCount.values()].reduce((a, b) => a + b, 0),
    [messageCount],
  );

  const expertName = (id: string) => auditors.find((a) => a.id === id)?.displayName ?? id;
  const convOf = (r: ConsultationRoom) => records.find((c) => c.id === r.conversationId);
  const ownerName = (r: ConsultationRoom) => convOf(r)?.ownerLabel || r.viewerId;

  if (!hydrated) return <LoadingBlock label="불러오는 중…" />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-4 py-4 md:px-6">
        <p className="text-xs text-muted-foreground break-keep">
          사장님과 세무사의 1:1 채팅방. 운영자에게는 <strong>대화 내용이 보이지 않습니다</strong> —
          메시지 수와 마지막 시각까지만 봅니다.
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          <StatTile
            label="전체"
            value={all.length}
            active={filter === "all"}
            onClick={() => setFilter("all")}
            testId="room-stat-all"
          />
          <StatTile
            label="열림"
            value={openCount}
            active={filter === "open"}
            onClick={() => setFilter("open")}
            testId="room-stat-open"
          />
          <StatTile
            label="닫힘"
            value={all.length - openCount}
            active={filter === "closed"}
            onClick={() => setFilter("closed")}
            testId="room-stat-closed"
          />
          <StatTile label="메시지" value={totalMessages} testId="room-stat-messages" />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.length === 0 ? (
          <EmptyRow>
            {all.length === 0 ? "아직 열린 채팅방이 없습니다." : "해당하는 채팅방이 없습니다."}
          </EmptyRow>
        ) : (
          <ul data-testid="admin-room-list">
            {list.map((room) => (
              <OpsCard key={room.id} testId="admin-room-row">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={cn(
                      "border-transparent",
                      room.status === "open"
                        ? "bg-brand-green/15 text-brand-green"
                        : "bg-muted text-muted-foreground",
                    )}
                    data-testid="admin-room-status"
                  >
                    {room.status === "open" ? "열림" : "닫힘"}
                  </Badge>
                  <span className="text-sm font-medium break-keep">
                    {ownerName(room)} ↔ {expertName(room.expertId)}
                  </span>
                </div>
                <p className="text-sm break-keep">
                  {convOf(room)?.title ?? `대화 ${middleTruncate(room.conversationId, 6, 4)}`}
                </p>
                <OpsMeta
                  items={[
                    ["메시지", `${messageCount.get(room.id) ?? 0}건`],
                    [
                      "마지막",
                      room.lastMessageAt ? formatDateTime(room.lastMessageAt) : "아직 없음",
                    ],
                    ["개설", formatDateTime(room.createdAt)],
                    ["출처", ORIGIN_LABEL[room.origin]],
                    ...(room.closedAt
                      ? ([["닫힘", formatDateTime(room.closedAt)]] as Array<[string, string]>)
                      : []),
                  ]}
                />
                {room.status === "open" ? (
                  <ConfirmAction
                    label="방 강제 종료"
                    confirmLabel="종료합니다"
                    warning="이 방을 닫습니다. 양쪽 모두 더 쓸 수 없고 읽기만 남습니다(운영자가 닫았다는 표시는 가지 않습니다). 같은 사장님·세무사가 다시 수락·승인하면 같은 방이 이전 메시지 그대로 다시 열립니다."
                    testId="admin-room-close"
                    onConfirm={async () => {
                      await roomService.closeRoom(room.id);
                    }}
                  />
                ) : null}
              </OpsCard>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

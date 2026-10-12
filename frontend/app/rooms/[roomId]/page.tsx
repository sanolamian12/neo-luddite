import { RoomView } from "@/components/room/room-view";

/**
 * 사장님 채팅방 — `/rooms/<방id>`. 들어오는 길은 둘: 사이드바 "세무사 채팅" 탭과 `/consultations` 상세의 [채팅방 열기].
 * 뒤로 가기는 들어온 길이 아니라 방의 출처(경로 A 신청 상세 / 경로 B 연결 요청)로 간다 — RoomView 기본값.
 */
export default async function OwnerRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{ arrive?: string }>;
}) {
  const { roomId } = await params;
  const { arrive } = await searchParams;
  const id = decodeURIComponent(roomId);
  // arrive=1 — 채팅 카드의 즉시 연결(R3)로 막 들어온 방: 전환 장면 + 세무사 AI 첫 인사.
  return <RoomView key={id} roomId={id} side="owner" arrive={arrive === "1"} />;
}

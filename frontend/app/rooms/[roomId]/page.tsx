import { RoomView } from "@/components/room/room-view";

/** 사장님 채팅방 — `/rooms/<방id>`. 방 목록은 (e) 사이드바 탭 분리 전까지 `/consultations` 상세의 [채팅방 열기]로 들어온다. */
export default async function OwnerRoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  const id = decodeURIComponent(roomId);
  return (
    <RoomView key={id} roomId={id} side="owner" backHref="/consultations" backLabel="세무사 상담으로" />
  );
}

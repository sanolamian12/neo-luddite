import { ExpertRoomsView } from "@/components/room/expert-rooms-view";

/**
 * 채팅방 — `/audit/rooms` 목록, `/audit/rooms/<방id>` 그 방을 연다,
 * `/audit/rooms/<방id>/conversation` 그 방의 AI 상담 원문(읽기 전용, 후속1 #5).
 */
export default async function AuditRoomsPage({
  params,
}: {
  params: Promise<{ id?: string[] }>;
}) {
  const { id } = await params;
  const roomId = id?.[0] ? decodeURIComponent(id[0]) : undefined;
  const view = id?.[1] === "conversation" ? "conversation" : "room";
  return <ExpertRoomsView roomId={roomId} view={view} />;
}

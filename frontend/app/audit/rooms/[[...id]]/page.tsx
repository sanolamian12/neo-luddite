import { ExpertRoomsView } from "@/components/room/expert-rooms-view";

/** 채팅방 — `/audit/rooms` 목록, `/audit/rooms/<방id>` 그 방을 연다. */
export default async function AuditRoomsPage({
  params,
}: {
  params: Promise<{ id?: string[] }>;
}) {
  const { id } = await params;
  const roomId = id?.[0] ? decodeURIComponent(id[0]) : undefined;
  return <ExpertRoomsView roomId={roomId} />;
}

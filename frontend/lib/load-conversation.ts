import {
  conversationSchema,
  type Conversation,
} from "./conversation-schema";
import clinicVehicleRaw from "@/data/conversations/clinic-vehicle.json";
import clinicGolfRaw from "@/data/conversations/clinic-golf.json";
import clinicGymRaw from "@/data/conversations/clinic-gym.json";

/**
 * 원시 데이터를 검증하여 타입 안전한 Conversation으로 반환한다.
 * 잘못된 구조면 ZodError를 throw 한다.
 */
export function parseConversation(raw: unknown): Conversation {
  return conversationSchema.parse(raw);
}

export function safeParseConversation(raw: unknown) {
  return conversationSchema.safeParse(raw);
}

/**
 * 번들된 대화 데이터 레지스트리.
 * (직업군 → 대화 매핑은 Phase 2의 lib/occupations.ts에서 처리)
 */
export const conversations: Record<string, Conversation> = {
  "clinic-vehicle": parseConversation(clinicVehicleRaw),
  "clinic-golf": parseConversation(clinicGolfRaw),
  "clinic-gym": parseConversation(clinicGymRaw),
};

export function getConversation(id: string): Conversation | null {
  return conversations[id] ?? null;
}

export function getConversations(ids: string[]): Conversation[] {
  return ids
    .map((id) => conversations[id])
    .filter((c): c is Conversation => Boolean(c));
}

/** 내부 conversation.id → 레지스트리 키 역조회 (챗 script.id로 감사 라우트 키 찾기) */
export function getConversationKeyById(internalId: string): string | null {
  const entry = Object.entries(conversations).find(
    ([, c]) => c.id === internalId,
  );
  return entry ? entry[0] : null;
}

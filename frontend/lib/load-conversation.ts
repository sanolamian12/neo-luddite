import {
  conversationSchema,
  type Conversation,
} from "./conversation-schema";
import { getStoredConversation } from "./conversation-store";
import clinicVehicleRaw from "@/data/conversations/clinic-vehicle.json";
import clinicGolfRaw from "@/data/conversations/clinic-golf.json";
import clinicGymRaw from "@/data/conversations/clinic-gym.json";
import { isPrototype } from "./data-mode";

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

function replayConversation(raw: unknown): Conversation {
  const conversation = parseConversation(raw);
  if (isPrototype) {
    const answer = conversation.messages.find((message) => message.role === "assistant");
    if (answer) answer.uiBlocks = [...(answer.uiBlocks ?? []), {
      kind: "expert_handoff",
      reason: "샘플 세무사를 찾아 상담 신청 흐름을 체험해 보세요.",
      note: "프로토타입 체험입니다. 실제 상담 신청은 전송되지 않습니다.",
    }];
  }
  return conversation;
}

/**
 * 번들된 대화 데이터 레지스트리.
 * (직업군 → 대화 매핑은 Phase 2의 lib/occupations.ts에서 처리)
 */
export const conversations: Record<string, Conversation> = {
  "clinic-vehicle": replayConversation(clinicVehicleRaw),
  "clinic-golf": replayConversation(clinicGolfRaw),
  "clinic-gym": replayConversation(clinicGymRaw),
};

export function getConversation(id: string): Conversation | null {
  // 정적 데모 번들 우선, 없으면 라이브 대화의 정지 스냅샷(conversation-store).
  return conversations[id] ?? getStoredConversation(id) ?? null;
}

export function getConversations(ids: string[]): Conversation[] {
  return ids
    .map((id) => conversations[id] ?? getStoredConversation(id))
    .filter((c): c is Conversation => Boolean(c));
}

/** 내부 conversation.id → 레지스트리 키 역조회 (챗 script.id로 감사 라우트 키 찾기) */
export function getConversationKeyById(internalId: string): string | null {
  const entry = Object.entries(conversations).find(
    ([, c]) => c.id === internalId,
  );
  if (entry) return entry[0];
  // 라이브 대화는 키 == conversation.id 로 동일하게 저장된다.
  if (getStoredConversation(internalId)) return internalId;
  return null;
}

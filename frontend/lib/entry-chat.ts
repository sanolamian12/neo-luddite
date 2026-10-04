import { createStore } from "zustand/vanilla";
import { createJSONStorage, persist } from "zustand/middleware";
import { z } from "zod";
import { messageSchema, type Message } from "./conversation-schema";

const conversationSchema = z.object({
  id: z.string(), scope: z.string(), occupation: z.literal("clinic"),
  createdAt: z.number(), updatedAt: z.number(), draft: z.string(),
  messages: z.array(messageSchema),
});
const savedSchema = z.object({ conversations: z.array(conversationSchema), landingDrafts: z.record(z.string(), z.string()) });
export type EntryConversation = z.infer<typeof conversationSchema>;
export type EntryScenario = "populated" | "empty" | "slow" | "error";
type ChatStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
/** Produces the assistant reply for a conversation whose last message is the user's. Live mode calls `/api/chat`. */
export type EntryResponder = (conversation: EntryConversation) => Promise<Message>;

export function chatHref(id?: string) {
  return `/chat/clinic${id ? `?c=${encodeURIComponent(id)}` : ""}`;
}

export function messageText(message: Message) {
  return message.segments.map((segment) => segment.text).join("\n");
}

export function conversationTitle(conversation: EntryConversation) {
  const first = conversation.messages.find((message) => message.role === "user");
  return first ? messageText(first).slice(0, 48) : "새 상담";
}

/** A local rehearsal of fact gathering, never generated advice or a legal conclusion. */
function sampleResponse(messages: Message[]): string {
  const questions = messages.filter((message) => message.role === "user");
  const first = messageText(questions[0]);
  if (questions.length === 1) {
    if (/차량|리스|운행|자동차/.test(first)) return "차량 비용에 관한 질문이군요. 먼저 업무용과 개인용 사용을 나누어 상황을 정리해 볼게요.\n\n차량을 어떤 업무에 사용하시나요? 개인적으로도 사용한다면 함께 알려 주세요.";
    if (/골프|접대|거래처|식사/.test(first)) return "거래처와 함께 쓴 비용에 관한 질문이군요. 어떤 자리였는지부터 정리해 볼게요.\n\n참석자는 누구였고, 업무와 관련해 어떤 목적으로 만났나요?";
    if (/헬스|복지|직원|회원권/.test(first)) return "직원을 위해 지출한 비용이군요. 이용 대상과 지급 방식을 먼저 살펴볼게요.\n\n모든 직원이 이용할 수 있나요, 아니면 특정 직원에게만 제공되나요?";
    return "말씀하신 상황부터 차근차근 정리해 볼게요.\n\n어떤 일을 하시고, 어떤 지출이나 거래가 궁금하신가요? 현재는 병의원 비용 상담을 예시로 대화 흐름을 체험할 수 있습니다.";
  }
  if (questions.length === 2) return `추가로 알려주신 내용은 “${messageText(questions[1]).slice(0, 180)}”이군요.\n\n이 내용을 처음 질문과 함께 확인할 사항으로 남겨 두겠습니다. 지출 시기와 금액, 가지고 계신 증빙도 알려 주시겠어요?`;
  return "질문과 추가 설명이 이 대화에 모였습니다. 지출 목적, 이용 대상, 시기·금액, 증빙을 함께 확인하면 전문가에게 상황을 전달하기가 한결 쉬워집니다.\n\n이 화면은 상황을 정리하는 샘플 대화입니다. 실제 비용 인정 여부를 판단한 답변은 아닙니다. 더 설명하고 싶은 내용이 있다면 이어서 적어 주세요.";
}

function makeMessage(role: Message["role"], text: string, order: number): Message {
  const id = crypto.randomUUID();
  return { id, role, order, segments: [{ id: `${id}-text`, text, type: role === "user" ? "question" : "follow_up" }] };
}

export interface EntryChatState {
  conversations: EntryConversation[];
  landingDrafts: Record<string, string>;
  pending: Record<string, boolean>;
  errors: Record<string, string | undefined>;
  create: (scope: string) => string;
  setLandingDraft: (scope: string, text: string) => void;
  setDraft: (id: string, scope: string, text: string) => void;
  adopt: (id: string | undefined, scope: string) => void;
  /** 서버에 저장된 내 대화(다른 기기에서 시작)를 이 브라우저로 가져온다. 이미 있으면 그대로 둔다. */
  restore: (conversation: Omit<EntryConversation, "draft">) => void;
  send: (id: string, scope: string, scenario?: EntryScenario) => Promise<boolean>;
  retry: (id: string, scope: string, scenario?: EntryScenario) => Promise<boolean>;
}

export function createEntryChatStore(storage?: ChatStorage, namespace = "populated", respond?: EntryResponder) {
  // Browsers may deny storage or run out of space. Keep the in-memory session usable.
  const safeStorage: ChatStorage = {
    getItem(key) { try { const raw = storage?.getItem(key); if (raw) { JSON.parse(raw); return raw; } } catch {} return null; },
    setItem(key, value) { try { storage?.setItem(key, value); } catch {} },
    removeItem(key) { try { storage?.removeItem(key); } catch {} },
  };
  return createStore<EntryChatState>()(persist((set, get) => ({
    conversations: [], landingDrafts: {}, pending: {}, errors: {},
    create(scope) {
      const id = `local-${crypto.randomUUID()}`;
      const now = Date.now();
      set((state) => ({
        conversations: [...state.conversations, { id, scope, occupation: "clinic", createdAt: now, updatedAt: now, messages: [], draft: state.landingDrafts[scope] ?? "" }],
        landingDrafts: { ...state.landingDrafts, [scope]: "" },
      }));
      return id;
    },
    setLandingDraft(scope, text) { set((state) => ({ landingDrafts: { ...state.landingDrafts, [scope]: text } })); },
    setDraft(id, scope, draft) {
      set((state) => ({ conversations: state.conversations.map((conversation) => conversation.id === id && conversation.scope === scope ? { ...conversation, draft } : conversation) }));
    },
    adopt(id, scope) {
      if (scope === "guest") return;
      set((state) => {
        const landingDrafts = { ...state.landingDrafts };
        if (!id && landingDrafts.guest) {
          landingDrafts[scope] = [landingDrafts[scope], landingDrafts.guest].filter(Boolean).join("\n");
          delete landingDrafts.guest;
        }
        return { landingDrafts, conversations: state.conversations.map((conversation) => conversation.id === id && conversation.scope === "guest" ? { ...conversation, scope } : conversation) };
      });
    },
    restore(conversation) {
      if (get().conversations.some((item) => item.id === conversation.id)) return;
      set((state) => ({ conversations: [...state.conversations, { ...conversation, draft: "" }] }));
    },
    async send(id, scope, scenario = "populated") {
      const conversation = get().conversations.find((item) => item.id === id && item.scope === scope);
      const text = conversation?.draft.trim();
      if (!conversation || !text || get().pending[id] || conversation.messages.at(-1)?.role === "user") return false;
      const message = makeMessage("user", text, conversation.messages.length);
      set((state) => ({ conversations: state.conversations.map((item) => item.id === id ? { ...item, draft: "", updatedAt: Date.now(), messages: [...item.messages, message] } : item) }));
      return get().retry(id, scope, scenario);
    },
    async retry(id, scope, scenario = "populated") {
      const conversation = get().conversations.find((item) => item.id === id && item.scope === scope);
      const last = conversation?.messages.at(-1);
      if (!conversation || last?.role !== "user" || get().pending[id]) return false;
      set((state) => ({ pending: { ...state.pending, [id]: true }, errors: { ...state.errors, [id]: undefined } }));
      let reply: Message | undefined;
      if (respond) {
        try {
          reply = await respond(conversation);
        } catch (error) {
          console.warn("[entry-chat] 응답 실패:", error);
          set((state) => ({ pending: { ...state.pending, [id]: false }, errors: { ...state.errors, [id]: "답변을 받지 못했어요. 질문은 보관되어 있습니다." } }));
          return false;
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, scenario === "slow" ? 1500 : 450));
        if (scenario === "error") {
          set((state) => ({ pending: { ...state.pending, [id]: false }, errors: { ...state.errors, [id]: "샘플 응답을 불러오지 못했어요. 질문은 보관되어 있습니다." } }));
          return false;
        }
      }
      // Scope can change during login; a reply belongs to its original conversation and turn.
      set((state) => ({
        conversations: state.conversations.map((item) => item.id === id && item.messages.at(-1)?.id === last.id
          ? { ...item, updatedAt: Date.now(), messages: [...item.messages, reply ? { ...reply, role: "assistant" as const, order: item.messages.length } : makeMessage("assistant", sampleResponse(item.messages), item.messages.length)] } : item),
        pending: { ...state.pending, [id]: false },
      }));
      return true;
    },
  }), {
    // Live chats keep their own key so sample conversations never mix into real ones.
    name: respond ? "entry-chat-v1:live" : `prototype-entry-chat-v1:${namespace}`, version: 1, skipHydration: true,
    storage: createJSONStorage(() => safeStorage),
    partialize: ({ conversations, landingDrafts }) => ({ conversations, landingDrafts }),
    merge: (saved, current) => {
      const parsed = savedSchema.safeParse(saved);
      return parsed.success ? { ...current, ...parsed.data } : current;
    },
  }));
}

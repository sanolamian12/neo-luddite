"use client";

import { z } from "zod";
import { messageSchema, type Message } from "@/lib/conversation-schema";
import type { OccupationKey } from "@/lib/occupations";

/**
 * Chat service — Seam A(Python FastAPI `/api/chat`) 원격 호출.
 *
 * 마스터설계 §3-3: 프론트 챗 런타임이 결정적 재생(replay) 대신 실제 Upstage 추론을
 * 태우는 지점. base URL 은 `NEXT_PUBLIC_API_BASE`(C 가 배포 후 확정). 응답 message 는
 * conversation-schema 의 Zod 로 검증 — 백엔드(schema.py)와 계약 불일치를 즉시 드러낸다.
 *
 * 컴플라이언스: 이 경로의 추론은 Upstage(국산) 단독. 프론트는 계약만 소비한다.
 */

/** 백엔드 schema.py 의 Occupation Literal 과 동일. occupations.ts 키와 일치. */
export type Occupation = OccupationKey;

export interface ChatSendInput {
  conversationId: string;
  occupation: Occupation;
  /** 이번 user turn 이전까지의 대화(백엔드는 history + userInput 을 합쳐 추론). */
  history: Message[];
  text: string;
  /** A/B 임팩트 스위치. false → RAG off baseline(`?rag=false`). 미지정 시 서버 RAG_ENABLED. */
  rag?: boolean;
}

// ── 응답 계약(schema.py ChatResponse) ─────────────────────────────────────────
const chatMetaSchema = z
  .object({
    engine: z.string().nullish(),
    extracted: z.record(z.string(), z.unknown()).nullish(),
    ragCaseRefs: z.array(z.string()).default([]),
    ragHits: z.number().default(0),
    followUp: z.boolean().default(false),
  })
  .passthrough();

const chatResponseSchema = z.object({
  message: messageSchema,
  meta: chatMetaSchema,
});

export type ChatMeta = z.infer<typeof chatMetaSchema>;

export interface ChatSendResult {
  message: Message;
  meta: ChatMeta;
}

function apiBase(): string {
  const base = process.env.NEXT_PUBLIC_API_BASE;
  if (!base) {
    throw new Error(
      "NEXT_PUBLIC_API_BASE 미설정 — 원격 챗(Seam A) 비활성. frontend/.env.local 확인 " +
        "(예: http://localhost:8787). 재생 모드로 전환하거나 백엔드를 띄우세요.",
    );
  }
  return base;
}

/** 원격 챗 활성 여부 — 토글 기본값 결정에 사용. */
export const isRemoteChatConfigured = Boolean(process.env.NEXT_PUBLIC_API_BASE);

/**
 * `/api/chat` 로 한 턴을 전송하고 검증된 assistant Message + meta 를 돌려준다.
 * 네트워크/검증 실패는 throw — 호출부(런타임)가 잡아 사용자에게 노출한다.
 */
export async function send(input: ChatSendInput): Promise<ChatSendResult> {
  const url = new URL("/api/chat", apiBase());
  if (input.rag === false) url.searchParams.set("rag", "false");

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: input.conversationId,
        occupation: input.occupation,
        history: input.history,
        userInput: { text: input.text },
      }),
    });
  } catch (err) {
    throw new Error(
      `Seam A 연결 실패(${url.origin}). 백엔드가 떠 있는지 확인하세요: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`/api/chat ${res.status} ${res.statusText}: ${detail.slice(0, 300)}`);
  }

  const json = await res.json();
  const parsed = chatResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `/api/chat 응답이 계약(conversation-schema)과 불일치: ${parsed.error.message.slice(0, 300)}`,
    );
  }
  return parsed.data;
}

import { z } from "zod";

/**
 * 대화 데이터 스키마 (Prototype 1)
 * ================================
 * 후속 프로토타입(문장별 트래킹 + 코멘트)에서 재사용되는 정합적 구조.
 * 세그먼트 ID는 주석 앵커링 키이므로 고유·불변이어야 한다.
 */

// 세그먼트 유형 — Goal2(결정문 구조) + Goal3(논리 흐름)에서 도출
export const SEGMENT_TYPES = [
  "context", // 사실관계 진술
  "question", // 질문
  "ack", // 수신 확인/공감
  "issue_framing", // 쟁점 제시
  "rule_statement", // 법리/규정 진술
  "application", // 사실관계에 법리 적용
  "evidence_request", // 증빙·입증 요구
  "conclusion", // 결론
  "caveat", // 단서/주의
  "follow_up", // 후속 질문/안내
] as const;

// 해석 프레임워크 — Goal3 태그
export const FRAMEWORKS = [
  "문언해석",
  "목적론해석",
  "체계적해석",
  "실질과세원칙",
  "신의성실원칙",
  "엄격해석",
  "입증책임",
  "유추해석",
] as const;

export const segmentSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  type: z.enum(SEGMENT_TYPES),
  framework: z.enum(FRAMEWORKS).optional(),
  citations: z.array(z.string()).optional(),
});

// ── 챗 내 구조화 UI 블록 (tool-ui 패턴 → shadcn 로컬 구현) ──────────────────────
export const verdictCardSchema = z.object({
  kind: z.literal("verdict_card"),
  verdict: z.enum(["전부인정", "안분인정", "부인", "조건부"]),
  title: z.string(),
  summary: z.string(),
});

export const evidenceChecklistSchema = z.object({
  kind: z.literal("evidence_checklist"),
  title: z.string(),
  items: z
    .array(
      z.object({
        label: z.string(),
        required: z.boolean(),
        note: z.string().optional(),
      }),
    )
    .min(1),
});

export const uiBlockSchema = z.discriminatedUnion("kind", [
  verdictCardSchema,
  evidenceChecklistSchema,
]);

export const messageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant"]),
  order: z.number().int().nonnegative(),
  segments: z.array(segmentSchema).min(1),
  uiBlocks: z.array(uiBlockSchema).optional(),
});

export const starterQuestionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
});

export const conversationSchema = z
  .object({
    id: z.string().min(1),
    schemaVersion: z.string().min(1),
    persona: z.object({
      occupation: z.string().min(1),
      label: z.string().min(1),
      businessType: z.string().min(1),
    }),
    topic: z.object({
      title: z.string().min(1),
      taxCategory: z.string().min(1),
      caseRefs: z.array(z.string()).default([]),
      frameworks: z.array(z.enum(FRAMEWORKS)).default([]),
    }),
    starterQuestions: z.array(starterQuestionSchema).min(1),
    messages: z.array(messageSchema).min(1),
  })
  .superRefine((conv, ctx) => {
    // 1) 세그먼트 ID 전역 고유성
    const seen = new Set<string>();
    for (const m of conv.messages) {
      for (const s of m.segments) {
        if (seen.has(s.id)) {
          ctx.addIssue({
            code: "custom",
            message: `중복 세그먼트 ID: ${s.id}`,
            path: ["messages"],
          });
        }
        seen.add(s.id);
      }
    }
    // 2) 메시지 order 오름차순(중복 없음)
    const orders = conv.messages.map((m) => m.order);
    for (let i = 1; i < orders.length; i++) {
      if (orders[i] <= orders[i - 1]) {
        ctx.addIssue({
          code: "custom",
          message: `메시지 order가 오름차순이 아님 (index ${i})`,
          path: ["messages", i, "order"],
        });
      }
    }
  });

// ── 타입 ────────────────────────────────────────────────────────────────────────
export type SegmentType = (typeof SEGMENT_TYPES)[number];
export type Framework = (typeof FRAMEWORKS)[number];
export type Segment = z.infer<typeof segmentSchema>;
export type UiBlock = z.infer<typeof uiBlockSchema>;
export type Message = z.infer<typeof messageSchema>;
export type StarterQuestion = z.infer<typeof starterQuestionSchema>;
export type Conversation = z.infer<typeof conversationSchema>;

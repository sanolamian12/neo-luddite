import { z } from "zod";

const text = z.string().max(6000);
export const learningSessionSchema = z.object({
  id: z.string(), title: z.string().min(1).max(100), kind: z.enum(["chat", "transcript", "sample"]),
  permitted: z.literal(true), createdAt: z.string(),
  source: z.object({ conversationId: z.string(), revision: z.number().int(), mode: z.enum(["all", "selected"]), messageIds: z.array(z.string()) }).optional(),
  turns: z.array(z.object({ id: z.string(), speaker: z.enum(["client", "expert", "agent"]), text: text.min(1), at: z.string(), authorName: z.string().optional() })).min(2).max(120),
});
export const sessionLessonSchema = z.object({
  id: z.string(), session: learningSessionSchema,
  title: z.string().max(100), facts: text, judgment: text, conclusion: text, exceptions: text, questions: text, keywords: z.string().max(500),
  scope: text, applicability: z.enum(["reusable", "session-only"]), evidenceConfirmed: z.boolean(),
  scenario: text, expected: text, tested: z.boolean(),
});
export const sessionIntakeSchema = z.object({ id: z.string().optional(), title: z.string().max(100), transcript: z.string().max(40000), kind: z.enum(["chat", "transcript", "sample"]), permitted: z.boolean() });
export const learningSchema = z.object({ sessions: z.array(learningSessionSchema).max(20), draft: sessionLessonSchema.optional(), intake: sessionIntakeSchema.optional() });
export type SessionIntake = z.infer<typeof sessionIntakeSchema>;
export type LearningSession = z.infer<typeof learningSessionSchema>;
export type SessionLesson = z.infer<typeof sessionLessonSchema>;

import { z } from "zod";

/**
 * 지식 베이스(Knowledge Base) 스키마 — 평가자(세무 전문가)가 작성·관리하는
 * 구조화된 지식 문서. Claude Skill 형식(마스터 + 폴더 트리)을 따른다.
 * 본 프로토타입은 v1: 읽기 전용 시드 + 단순 사용자 확장만 지원.
 */

// ── 카테고리 ────────────────────────────────────────────────────────────────────
export const KB_CATEGORIES = [
  "skill-master",
  "interpretation-framework",
  "occupation",
  "case-precedent",
  "glossary",
  "pitfall",
] as const;
export type KbCategory = (typeof KB_CATEGORIES)[number];

export const KB_CATEGORY_LABELS: Record<KbCategory, string> = {
  "skill-master": "마스터",
  "interpretation-framework": "해석론",
  occupation: "직업군",
  "case-precedent": "판례노트",
  glossary: "용어집",
  pitfall: "오류패턴",
};

/**
 * 카테고리별 폴더 (path 첫 세그먼트).
 * **path 는 ASCII**, 사용자에게 노출되는 라벨은 `KB_FOLDER_LABELS` 로 매핑.
 */
export const KB_CATEGORY_FOLDERS: Record<KbCategory, string> = {
  "skill-master": "",
  "interpretation-framework": "interpretation-frameworks",
  occupation: "occupations",
  "case-precedent": "case-precedents",
  glossary: "glossary",
  pitfall: "pitfalls",
};

/**
 * 폴더 세그먼트(영문) → 한국어 표시 라벨.
 * 폴더 트리·브레드크럼 등 path 세그먼트를 직접 노출할 때 사용한다.
 * 매핑이 없으면 세그먼트 자체를 fallback.
 */
export const KB_FOLDER_LABELS: Record<string, string> = {
  "interpretation-frameworks": "해석론",
  occupations: "직업군",
  clinic: "병의원",
  "case-precedents": "판례노트",
  glossary: "용어집",
  pitfalls: "오류패턴",
};

export function folderLabel(segment: string): string {
  return KB_FOLDER_LABELS[segment] ?? segment;
}

// ── 인용 ────────────────────────────────────────────────────────────────────────
export const kbCitationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("case"),
    caseId: z.string().min(1),
    label: z.string().optional(),
  }),
  z.object({
    kind: z.literal("law"),
    ref: z.string().min(1),
    label: z.string().optional(),
  }),
  z.object({
    kind: z.literal("external"),
    url: z.string().url(),
    label: z.string().min(1),
  }),
]);
export type KbCitation = z.infer<typeof kbCitationSchema>;

// ── 상태/출처 ───────────────────────────────────────────────────────────────────
export const KB_STATUSES = ["draft", "published"] as const;
export type KbStatus = (typeof KB_STATUSES)[number];

export const KB_SOURCES = ["seed", "user"] as const;
export type KbSource = (typeof KB_SOURCES)[number];

// ── 프론트매터 ──────────────────────────────────────────────────────────────────
export const kbFrontmatterSchema = z.object({
  title: z.string().min(1),
  summary: z.string().optional(),
  tags: z.array(z.string()).optional(),
  occupation: z.string().optional(),
  caseId: z.string().optional(),
  framework: z.string().optional(),
});
export type KbFrontmatter = z.infer<typeof kbFrontmatterSchema>;

// ── 문서 ────────────────────────────────────────────────────────────────────────
export const kbDocumentSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1), // "직업군/병의원/차량유지비" — 확장자 없음
  category: z.enum(KB_CATEGORIES),
  frontmatter: kbFrontmatterSchema,
  body: z.string(), // markdown — `[[경로]]` 위키 링크 지원
  citations: z.array(kbCitationSchema).default([]),
  source: z.enum(KB_SOURCES),
  status: z.enum(KB_STATUSES),
  reviewer: z.string().min(1),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type KbDocument = z.infer<typeof kbDocumentSchema>;

// ── 헬퍼 ────────────────────────────────────────────────────────────────────────
/** path 의 마지막 세그먼트 (사용자에게 보이는 파일명). */
export function pathLeaf(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

/** path 의 부모 폴더 (없으면 빈 문자열). */
export function pathParent(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

/** path 가 같은 폴더에 속하는지 검사. */
export function inFolder(path: string, folder: string): boolean {
  if (folder === "") return !path.includes("/");
  return path.startsWith(`${folder}/`);
}

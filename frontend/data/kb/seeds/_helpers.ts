import type {
  KbCategory,
  KbCitation,
  KbDocument,
  KbFrontmatter,
} from "@/lib/kb-schema";
import { KB_CATEGORY_FOLDERS } from "@/lib/kb-schema";

/**
 * 시드 문서 생성 헬퍼. 카테고리 폴더 접두사는 자동으로 붙는다.
 *
 *   defineSeed({
 *     category: "interpretation-framework",
 *     subPath: "엄격해석",        // → "해석론/엄격해석"
 *     ...
 *   })
 */

const SEED_TIMESTAMP = new Date("2025-06-01T00:00:00Z").getTime();

export function defineSeed(input: {
  category: KbCategory;
  /** 카테고리 폴더 기준 상대 경로. skill-master 는 전체 경로(보통 "스킬"). */
  subPath: string;
  frontmatter: KbFrontmatter;
  body: string;
  citations?: KbCitation[];
}): KbDocument {
  const folder = KB_CATEGORY_FOLDERS[input.category];
  const path = folder ? `${folder}/${input.subPath}` : input.subPath;
  return {
    id: `seed-${path}`,
    path,
    category: input.category,
    frontmatter: input.frontmatter,
    body: input.body.trim() + "\n",
    citations: input.citations ?? [],
    source: "seed",
    status: "published",
    reviewer: "시드",
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  };
}

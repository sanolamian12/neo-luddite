import {
  KB_CATEGORY_FOLDERS,
  type KbCategory,
  type KbFrontmatter,
} from "./kb-schema";

/**
 * KB path 생성·정규화 헬퍼.
 *
 * **원칙:** path 는 항상 **ASCII**. 사용자에게 노출되는 라벨(제목)은 한국어이지만,
 * URL/스토어 매칭 안정을 위해 path 세그먼트는 영문/숫자/`-`로 제한한다.
 * Korean 또는 비 ASCII 입력이 들어오면 무작위 슬러그(`doc-XXXXXX`)로 대체한다.
 */

function isAsciiPrintable(s: string): boolean {
  return /^[\x20-\x7E]+$/.test(s);
}

/** 입력 문자열의 결정적 6자리 base36 해시 (FNV-1a 32bit). */
function hashSlug(input: string, prefix: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${prefix}-${(h >>> 0).toString(36).padStart(6, "0").slice(0, 6)}`;
}

/**
 * 텍스트를 ASCII 슬러그로 정규화.
 * - 비 ASCII 포함 → 결정적 해시 슬러그 (`${prefix}-XXXXXX`)
 * - ASCII → 소문자·하이픈 정규화
 * - 빈 문자열 → `${prefix}-untitled`
 *
 * 결정적이므로 같은 입력은 같은 path 를 만들어내고, 편집 중 미리보기가 안정.
 */
export function asciiSlug(input: string, prefix = "doc"): string {
  const trimmed = input.trim();
  if (!trimmed) return `${prefix}-untitled`;
  if (!isAsciiPrintable(trimmed)) return hashSlug(trimmed, prefix);

  const cleaned = trimmed
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return cleaned || hashSlug(trimmed, prefix);
}

/** @deprecated 호환을 위해 유지. 신규 코드는 `asciiSlug` 사용. */
export function slugifyTitle(title: string): string {
  return asciiSlug(title, "doc");
}

/** 카테고리/프론트매터에서 후보 path 생성 (충돌 처리 전, ASCII 보장). */
export function buildCandidatePath(
  category: KbCategory,
  frontmatter: KbFrontmatter,
): string {
  const folder = KB_CATEGORY_FOLDERS[category];

  if (category === "skill-master") {
    return "skill";
  }

  const titleSlug = asciiSlug(frontmatter.title, "doc");

  if (category === "occupation") {
    const occRaw = (frontmatter.occupation || "general").trim();
    const occSlug = asciiSlug(occRaw, "occ");
    return `${folder}/${occSlug}/${titleSlug}`;
  }
  if (category === "case-precedent") {
    // caseId 가 ASCII 면 그대로, Korean 이면 무작위 case 슬러그.
    const idRaw = (frontmatter.caseId ?? frontmatter.title).trim();
    const idSlug = asciiSlug(idRaw, "case");
    return `${folder}/${idSlug}`;
  }
  return `${folder}/${titleSlug}`;
}

/** path 가 taken 안에 있으면 `-2`, `-3` 등 접미사로 유일화. */
export function uniqPath(desired: string, taken: ReadonlySet<string>): string {
  if (!taken.has(desired)) return desired;
  let i = 2;
  while (taken.has(`${desired}-${i}`)) i++;
  return `${desired}-${i}`;
}

/** 시드 path 의 사본 후보. `interpretation-frameworks/strict-interpretation` → `…-copy`. */
export function copyPath(originalPath: string): string {
  return `${originalPath}-copy`;
}

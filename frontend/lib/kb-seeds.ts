import type { KbDocument } from "./kb-schema";
import { KB_SEEDS } from "@/data/kb/seeds";

/**
 * 서버·클라이언트 모두 안전한 시드 접근. user 문서 통합은 클라이언트 훅
 * (`useKbDocuments` in `load-kb-seeds.ts`)에서 처리.
 */

export { KB_SEEDS };

export function getKbSeedByPath(path: string): KbDocument | null {
  return KB_SEEDS.find((d) => d.path === path) ?? null;
}

export function mergeKbDocuments(
  seeds: KbDocument[],
  userDocs: KbDocument[],
): KbDocument[] {
  const map = new Map<string, KbDocument>();
  for (const d of seeds) map.set(d.path, d);
  for (const d of userDocs) map.set(d.path, d); // user 우선
  return [...map.values()];
}

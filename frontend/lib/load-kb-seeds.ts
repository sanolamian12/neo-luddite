"use client";

import { useMemo } from "react";
import type { KbDocument } from "./kb-schema";
import { KB_SEEDS, mergeKbDocuments } from "./kb-seeds";
import { useKbStore } from "./kb-store";

/** 시드 + 사용자 문서 통합 (클라이언트 전용). path 충돌 시 user 우선. */
export function useKbDocuments(): KbDocument[] {
  const userDocs = useKbStore((s) => s.documents);
  return useMemo(() => mergeKbDocuments(KB_SEEDS, userDocs), [userDocs]);
}

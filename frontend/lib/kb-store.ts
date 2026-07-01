"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { KbCitation, KbDocument, KbFrontmatter } from "./kb-schema";
import { KB_SEEDS } from "./kb-seeds";
import { buildCandidatePath, copyPath, uniqPath } from "./kb-utils";

/**
 * KB 스토어 — 사용자 작성/확장 문서만 영속. 시드는 코드에서 합성.
 *
 * B4 활성 액션:
 * - createNew    — 빈 문서 생성 (카테고리/프론트매터 기반 path 자동)
 * - extendFromSeed — 시드 사본 (path 에 `-사본` 붙임)
 * - upsert       — 기존 문서 편집
 * - remove       — user 문서 삭제
 */

interface CreateInput {
  category: KbDocument["category"];
  frontmatter: KbFrontmatter;
  body: string;
  citations?: KbCitation[];
  reviewer: string;
  status?: KbDocument["status"];
}

interface KbState {
  documents: KbDocument[];
  createNew: (input: CreateInput) => KbDocument;
  extendFromSeed: (seed: KbDocument, reviewer: string) => KbDocument;
  upsert: (doc: KbDocument) => void;
  remove: (id: string) => void;
}

const noopStorage: Storage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  key: () => null,
  length: 0,
};

function allTakenPaths(userDocs: KbDocument[]): Set<string> {
  const taken = new Set<string>();
  for (const d of KB_SEEDS) taken.add(d.path);
  for (const d of userDocs) taken.add(d.path);
  return taken;
}

export const useKbStore = create<KbState>()(
  persist(
    (set, get) => ({
      documents: [],

      createNew: (input) => {
        const state = get();
        const candidate = buildCandidatePath(input.category, input.frontmatter);
        const path = uniqPath(candidate, allTakenPaths(state.documents));
        const now = Date.now();
        const doc: KbDocument = {
          id: crypto.randomUUID(),
          path,
          category: input.category,
          frontmatter: input.frontmatter,
          body: input.body,
          citations: input.citations ?? [],
          source: "user",
          status: input.status ?? "draft",
          reviewer: input.reviewer,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ documents: [...s.documents, doc] }));
        return doc;
      },

      extendFromSeed: (seed, reviewer) => {
        const state = get();
        const path = uniqPath(copyPath(seed.path), allTakenPaths(state.documents));
        const now = Date.now();
        const doc: KbDocument = {
          id: crypto.randomUUID(),
          path,
          category: seed.category,
          frontmatter: {
            ...seed.frontmatter,
            title: `${seed.frontmatter.title} (사본)`,
          },
          body: seed.body,
          citations: [...seed.citations],
          source: "user",
          status: "draft",
          reviewer,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ documents: [...s.documents, doc] }));
        return doc;
      },

      upsert: (doc) =>
        set((s) => {
          const exists = s.documents.some((d) => d.id === doc.id);
          const next = { ...doc, updatedAt: Date.now() };
          return {
            documents: exists
              ? s.documents.map((d) => (d.id === doc.id ? next : d))
              : [...s.documents, next],
          };
        }),

      remove: (id) =>
        set((s) => ({ documents: s.documents.filter((d) => d.id !== id) })),
    }),
    {
      name: "kb-store-v1",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : noopStorage,
      ),
    },
  ),
);

export function useKbHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (useKbStore.persist.hasHydrated()) setHydrated(true);
    const unsub = useKbStore.persist.onFinishHydration(() => setHydrated(true));
    return unsub;
  }, []);
  return hydrated;
}

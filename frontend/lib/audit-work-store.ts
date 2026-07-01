"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { auditSchema, type Audit } from "./poc-schema";
import auditorHistorySeed from "@/data/poc-seeds/auditor-history.json";

/**
 * Audit metadata (pickup → submit → ...) 의 영속 스토어.
 * 라인 피드백 / 세션 평가는 기존 audit-store(v1) 가 conversationId 키로 보유.
 * P2 에서 둘을 auditId 기준으로 통합 예정.
 *
 * 시드: `auditor-history.json` 의 audits — auditor-2/3 의 과거 활동 데이터.
 */

interface AuditWorkState {
  audits: Audit[];
  seedApplied: boolean;
  _upsert: (audit: Audit) => void;
  _patch: (id: string, patch: Partial<Audit>) => void;
  _remove: (id: string) => void;
  _hydrateSeeds: () => void;
}

const noopStorage: Storage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  key: () => null,
  length: 0,
};

function loadAuditSeeds(): Audit[] {
  const raw = (auditorHistorySeed as { audits?: unknown }).audits ?? [];
  if (!Array.isArray(raw)) return [];
  const out: Audit[] = [];
  const now = Date.now();
  for (const item of raw) {
    const parsed = auditSchema.safeParse(item);
    if (!parsed.success) continue;
    const a = parsed.data;
    // 시드의 timestamp 가 과거(60일+)면 데모 가독성을 위해 최근 N일 전으로 보정
    if (a.submittedAt && now - a.submittedAt > 60 * 86_400_000) {
      const offset = (5 + out.length * 4) * 86_400_000;
      a.pickedAt = now - offset - 86_400_000;
      a.submittedAt = now - offset;
    }
    out.push(a);
  }
  return out;
}

export const useAuditWorkStore = create<AuditWorkState>()(
  persist(
    (set, get) => ({
      audits: [],
      seedApplied: false,

      _upsert: (audit) =>
        set((s) => {
          const valid = auditSchema.parse(audit);
          const idx = s.audits.findIndex((a) => a.id === valid.id);
          if (idx === -1) return { audits: [...s.audits, valid] };
          const next = [...s.audits];
          next[idx] = { ...next[idx], ...valid };
          return { audits: next };
        }),

      _patch: (id, patch) =>
        set((s) => ({
          audits: s.audits.map((a) => (a.id === id ? { ...a, ...patch } : a)),
        })),

      _remove: (id) =>
        set((s) => ({ audits: s.audits.filter((a) => a.id !== id) })),

      _hydrateSeeds: () => {
        if (get().seedApplied) return;
        const seeds = loadAuditSeeds();
        set((s) => {
          const existing = new Set(s.audits.map((a) => a.id));
          const additions = seeds.filter((a) => !existing.has(a.id));
          return {
            audits: [...s.audits, ...additions],
            seedApplied: true,
          };
        });
      },
    }),
    {
      name: "audit-work-store-v1",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : noopStorage,
      ),
      partialize: (s) => ({ audits: s.audits, seedApplied: s.seedApplied }),
    },
  ),
);

export function useAuditWorkHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  const hydrate = useAuditWorkStore((s) => s._hydrateSeeds);
  useEffect(() => {
    const apply = () => {
      hydrate();
      setHydrated(true);
    };
    if (useAuditWorkStore.persist.hasHydrated()) apply();
    const unsub = useAuditWorkStore.persist.onFinishHydration(apply);
    return unsub;
  }, [hydrate]);
  return hydrated;
}

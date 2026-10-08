"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { getSupabase } from "./supabase/client";

/**
 * 세무사 이름 목록 — list_expert_names() (0049). auditors 표는 본인·관리자만 읽을 수 있어
 * (연락처·관리자 메모 보호) 고객 화면은 이름을 여기서 얻는다. 이름은 자주 안 바뀌어 한 번만 당긴다.
 */
interface ExpertNamesState {
  names: Map<string, string> | null;
}

export const useExpertNamesStore = create<ExpertNamesState>()(() => ({ names: null }));

let inflight: Promise<void> | null = null;

export function loadExpertNames(force = false): Promise<void> {
  if (inflight && !force) return inflight;
  if (useExpertNamesStore.getState().names && !force) return Promise.resolve();
  inflight = (async () => {
    try {
      const { data, error } = await getSupabase().rpc("list_expert_names");
      if (error) throw error;
      const rows = (data ?? []) as { id: string; display_name: string }[];
      useExpertNamesStore.setState({ names: new Map(rows.map((r) => [r.id, r.display_name])) });
    } catch {
      // 비로그인·일시 오류 — 빈 목록으로 두고 화면은 id 대신 "세무사"로 표시한다.
      useExpertNamesStore.setState((s) => ({ names: s.names ?? new Map() }));
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** 이름과 적재 완료 여부. 적재 전엔 name 이 undefined. */
export function useExpertName(expertId: string | null | undefined): { name?: string; loaded: boolean } {
  useEffect(() => { void loadExpertNames(); }, []);
  const name = useExpertNamesStore((s) => (expertId ? s.names?.get(expertId) : undefined));
  const loaded = useExpertNamesStore((s) => s.names !== null);
  return { name, loaded };
}

/** 여러 이름을 쓰는 목록 화면용. */
export function useExpertNames(): { nameOf: (id: string) => string | undefined; loaded: boolean } {
  useEffect(() => { void loadExpertNames(); }, []);
  const names = useExpertNamesStore((s) => s.names);
  return { nameOf: (id) => names?.get(id), loaded: names !== null };
}

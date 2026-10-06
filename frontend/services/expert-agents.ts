"use client";

/**
 * 에이전트 스튜디오 설정의 서버 저장(0044 expert_agents · design/세무사에이전트_3자방_설계.md D4·D5).
 *
 * 브라우저 localStorage 에만 있던 에이전트(사례·확인 질문·운영 원칙 통째)를 서버에 둔다 —
 * 다른 브라우저에서도 같은 지식 모음이 보이고(10/6 발견 1), 3자 방 세무사 AI 가 원칙·질문을 프롬프트로 쓴다.
 * 신원 = 로그인 세션(RLS: expert_id = auth.uid()). 방에서 쓸 에이전트는 세무사당 1개(없으면 첫 에이전트).
 */

import type { Agent } from "@/lib/agent-studio";
import { getSupabase } from "@/lib/supabase/client";

interface Row {
  agent_id: string;
  agent: Agent;
  is_room_agent: boolean;
  created_at: number | string;
}

export interface ServerAgents {
  agents: Agent[];
  roomAgentId?: string;
}

async function myUid(): Promise<string> {
  const { data } = await getSupabase().auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) throw new Error("로그인이 필요합니다");
  return uid;
}

export async function loadServerAgents(): Promise<ServerAgents> {
  const { data, error } = await getSupabase()
    .from("expert_agents")
    .select("agent_id, agent, is_room_agent, created_at")
    .order("created_at");
  if (error) throw error;
  const rows = (data ?? []) as Row[];
  return { agents: rows.map((r) => r.agent), roomAgentId: rows.find((r) => r.is_room_agent)?.agent_id };
}

/** 화면의 에이전트 목록을 서버와 같게 — upsert + 목록에 없는 것 삭제. 방 에이전트 표시는 먼저 다 끄고 하나만 켠다(부분 유니크). */
export async function saveServerAgents(agents: Agent[], roomAgentId: string | undefined): Promise<void> {
  const sb = getSupabase();
  const uid = await myUid();
  const now = Date.now();
  const { data: existing, error: e0 } = await sb.from("expert_agents").select("agent_id, created_at");
  if (e0) throw e0;
  const created = new Map(((existing ?? []) as Pick<Row, "agent_id" | "created_at">[]).map((r) => [r.agent_id, Number(r.created_at)]));
  const { error: e1 } = await sb.from("expert_agents").update({ is_room_agent: false }).eq("expert_id", uid).eq("is_room_agent", true);
  if (e1) throw e1;
  const rows = agents.map((a, i) => ({
    expert_id: uid,
    agent_id: a.id,
    name: a.name.slice(0, 100),
    agent: a,
    is_room_agent: a.id === roomAgentId,
    created_at: created.get(a.id) ?? now + i,   // 새 에이전트는 화면 순서대로(첫 에이전트 = 기본 방 에이전트)
    updated_at: now,
  }));
  const { error: e2 } = await sb.from("expert_agents").upsert(rows, { onConflict: "expert_id,agent_id" });
  if (e2) throw e2;
  const gone = [...created.keys()].filter((id) => !agents.some((a) => a.id === id));
  if (gone.length) {
    const { error: e3 } = await sb.from("expert_agents").delete().eq("expert_id", uid).in("agent_id", gone);
    if (e3) throw e3;
  }
}

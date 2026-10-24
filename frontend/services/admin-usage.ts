import { getSupabase } from "@/lib/supabase/client";

/**
 * 관리자 사용 현황 2판(0064) — 방문·유입 경로·질문·세무사 연결 수요.
 * 집계 규칙(직원·데모 브라우저 제외, 경로 분류, KST)은 DB 한 곳(0064 analytics._visitors 등)에 있다.
 */

export interface UsageKpi {
  visitors: number;
  sessions: number;
  questions: number;
  signups: number;
  handoffClicks: number;
  connections: number;
}
export type KpiKey = keyof UsageKpi;

export interface SourceMetrics {
  visitors: number;
  asked: number;
  sessions: number;
  questions: number;
  signups: number;
  clicked: number;
  connections: number;
}
export interface SourceRow extends SourceMetrics {
  source: string;
  campaigns: (SourceMetrics & { campaign: string })[];
}

export interface TrafficDay {
  day: string;
  visitors: number;
  sessions: number;
  questions: number;
  signups: number;
  clicks: number;
  connections: number;
}

export interface TrafficOverview {
  days: number;
  source: string | null;
  from: number;
  generatedAt: number;
  trackingSince: number | null;
  liveNow: number;
  kpi: UsageKpi;
  prev: UsageKpi;
  funnel: { visitors: number; asked: number; shown: number; clicked: number; connected: number; signedUp: number };
  sources: SourceRow[];
  daily: TrafficDay[];
  unattributedTurns: number;
}

export interface QuestionStats {
  days: number;
  total: number;
  sessions: number;
  unclassified: number;
  byTopic: Record<string, number>;
  byType: Record<string, number>;
  byOutcome: Record<string, number>;
  perSession: Record<string, number>;
}

export interface QuestionRow {
  id: number;
  at: number;
  conversationId: string;
  source: string;
  campaign: string | null;
  taxTopic: string | null;
  questionType: string | null;
  outcome: string | null;
  text: string;
  clicked: boolean;
}

export interface HandoffDemand {
  days: number;
  funnel: {
    shown: number; shownAi: number; opened: number; clicked: number;
    clickedMember: number; clickedGuest: number; clickedInstant: number;
    requests: number; requestsInstant: number;
  };
  byReason: { reason: string; conversations: number; clicked: number }[];
  byStatus: Record<string, number>;
  recent: {
    id: string; at: number; source: string; campaign: string | null; taxTopic: string | null;
    instant: boolean; status: string; expertName: string | null; virtualExpert: boolean;
  }[];
}

export interface Campaign {
  code: string;
  source: string;
  medium: string;
  campaign: string | null;
  label: string | null;
  createdAt: number;
  visitors: number;
}

/** 경로 코드 → 화면 이름. 모르는 코드(사이트 호스트·새 utm)는 그대로 보인다. */
export const SOURCE_LABEL: Record<string, string> = {
  apsa: "아프니까 사장이다",
  kyungrinara: "경리나라",
  naver_cafe: "네이버 카페",
  naver_search: "네이버 검색",
  naver_blog: "네이버 블로그",
  naver: "네이버(기타)",
  daum_cafe: "다음 카페",
  daum: "다음",
  kakao: "카카오",
  band: "밴드",
  google: "구글",
  facebook: "페이스북",
  instagram: "인스타그램",
  youtube: "유튜브",
  threads: "스레드",
  x: "X(트위터)",
  bing: "빙",
  direct: "직접 방문",
  unregistered: "등록 안 된 코드",
};
export const sourceLabel = (source: string) => SOURCE_LABEL[source] ?? source;

/** 서버 기록 카드 노출 사유(chat_turns.handoff_reason). */
export const REASON_LABEL: Record<string, string> = {
  explicit: "직접 요청",
  advisory: "자문형 답변 뒤 권유",
  no_precedent: "근거 없음",
  stalled: "대화 막힘",
};

export const KPI_LABEL: Record<KpiKey, string> = {
  visitors: "방문자",
  sessions: "채팅 세션",
  questions: "질문",
  signups: "신규 사장님 가입",
  handoffClicks: "세무사 연결 클릭",
  connections: "연결 성립",
};

const EMPTY_KPI: UsageKpi = { visitors: 0, sessions: 0, questions: 0, signups: 0, handoffClicks: 0, connections: 0 };

/** 직전 기간 대비. 직전이 0 이면 비율 대신 null(화면은 "새로" 또는 "—"). */
export function delta(cur: number, prev: number): { diff: number; pct: number | null } {
  return { diff: cur - prev, pct: prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null };
}

/** 0 으로 나누지 않는 백분율(정수). */
export const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null);

/** 게시 링크 — 단축 경로 /r/<code>(next.config redirects 가 ?ref= 로 바꿔 첫 유입에 남긴다). */
export const campaignLink = (origin: string, code: string) => `${origin.replace(/\/$/, "")}/r/${code}`;

export const CODE_PATTERN = /^[a-z0-9_-]{1,40}$/;

const n = (v: unknown) => Number(v ?? 0);

export async function trafficOverview(days: number, source: string | null = null): Promise<TrafficOverview> {
  const { data, error } = await getSupabase().rpc("admin_traffic_overview", { p_days: days, p_source: source });
  if (error) throw error;
  const d = data as TrafficOverview;
  return { ...d, kpi: { ...EMPTY_KPI, ...d.kpi }, prev: { ...EMPTY_KPI, ...d.prev }, liveNow: n(d.liveNow), unattributedTurns: n(d.unattributedTurns), sources: d.sources ?? [], daily: d.daily ?? [] };
}

export async function questionStats(days: number, source: string | null = null): Promise<QuestionStats> {
  const { data, error } = await getSupabase().rpc("admin_question_stats", { p_days: days, p_source: source });
  if (error) throw error;
  return data as QuestionStats;
}

export async function questionFeed(input: {
  days: number; source?: string | null; topic?: string | null; outcomes?: string[] | null; limit?: number; offset?: number;
}): Promise<{ total: number; rows: QuestionRow[] }> {
  const { data, error } = await getSupabase().rpc("admin_question_feed", {
    p_days: input.days,
    p_source: input.source ?? null,
    p_topic: input.topic ?? null,
    p_outcomes: input.outcomes ?? null,
    p_limit: input.limit ?? 30,
    p_offset: input.offset ?? 0,
  });
  if (error) throw error;
  return data as { total: number; rows: QuestionRow[] };
}

export async function handoffDemand(days: number, source: string | null = null): Promise<HandoffDemand> {
  const { data, error } = await getSupabase().rpc("admin_handoff_demand", { p_days: days, p_source: source });
  if (error) throw error;
  return data as HandoffDemand;
}

export async function listCampaigns(): Promise<Campaign[]> {
  const { data, error } = await getSupabase().rpc("admin_list_campaigns");
  if (error) throw error;
  return (data ?? []) as Campaign[];
}

export async function saveCampaign(input: { code: string; source: string; campaign?: string; label?: string }): Promise<void> {
  const { error } = await getSupabase().rpc("admin_save_campaign", {
    p_code: input.code, p_source: input.source, p_campaign: input.campaign ?? null, p_label: input.label ?? null,
  });
  if (error) {
    if (/invalid code/.test(error.message)) throw new Error("코드는 영문 소문자·숫자·-·_ 로 40자까지예요.");
    if (/invalid source/.test(error.message)) throw new Error("채널 코드는 영문 소문자·숫자·-·_ 로 40자까지예요.");
    throw new Error("저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
  }
}

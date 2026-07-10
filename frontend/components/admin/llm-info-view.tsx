"use client";

import { useEffect, useState } from "react";
import {
  BrainCircuit,
  CheckCircle2,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wrench,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import * as ragService from "@/services/rag";
import type { ServiceHealth } from "@/services/rag";

/**
 * AI 코어 › LLM — 이 서비스가 호출하는 국산 LLM(Upstage Solar) 정보 화면.
 * 실측값(reference_upstage_api)은 정적으로, 연결/모델은 /health 라이브로 표시한다.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "(미설정)";

// reference_upstage_api — 2026-07-02 실호출 검증값
const FACTS: { label: string; value: string; note?: string }[] = [
  { label: "베이스 URL", value: "https://api.upstage.ai/v1", note: "OpenAI 완전 호환" },
  { label: "채팅 모델", value: "solar-pro3", note: "2026-01-26 · 답변 작문 + 입력추출" },
  { label: "임베딩 모델", value: "embedding-query / embedding-passage", note: "RAG 질의·문서 벡터화" },
  { label: "Function calling", value: "지원", note: "clinic 지출 추출 tool_call 검증" },
];

const USAGES: { icon: React.ComponentType<{ className?: string }>; title: string; desc: string }[] = [
  { icon: MessageSquare, title: "상담 답변 작문", desc: "세그먼트(segments) 생성 — 사용자 질문에 대한 세무 답변" },
  { icon: Wrench, title: "입력 추출", desc: "function-calling 으로 clinic 지출 등 구조화 입력 파싱" },
  { icon: Sparkles, title: "RAG 임베딩", desc: "검수 코멘트·질의를 embedding-passage/query 로 벡터화" },
];

export function LlmInfoView() {
  const [health, setHealth] = useState<ServiceHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const h = await ragService.getServiceHealth();
      setHealth(h);
      setError(null);
    } catch (e) {
      setHealth(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const h = await ragService.getServiceHealth();
        if (!ignore) {
          setHealth(h);
          setError(null);
        }
      } catch (e) {
        if (!ignore) {
          setHealth(null);
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-5 px-6 py-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <BrainCircuit className="size-6 text-brand-amber" />
            LLM — Upstage Solar
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            이 서비스가 호출하는 국산 LLM. 답변 작문·입력 추출·RAG 임베딩이 전부 이 한
            모델군으로 처리됩니다.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="size-3.5" />
          새로고침
        </Button>
      </header>

      {/* 라이브 연결 상태 */}
      <section className="rounded-xl border bg-card">
        <header className="border-b px-4 py-2 text-sm font-semibold">연결 상태 (라이브)</header>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 px-4 py-4">
          <div className="flex items-center gap-2">
            {loading ? (
              <Badge variant="outline">확인 중…</Badge>
            ) : health?.ok ? (
              <Badge variant="default" className="gap-1">
                <CheckCircle2 className="size-3.5" /> 연결됨
              </Badge>
            ) : (
              <Badge variant="destructive" className="gap-1">
                <XCircle className="size-3.5" /> 응답 없음
              </Badge>
            )}
          </div>
          <Field label="백엔드(Seam A)" value={API_BASE} mono />
          <Field label="연결 모델" value={health?.model ?? "—"} mono />
          <Field label="서비스" value={health?.service ?? "—"} mono />
        </div>
        {error && (
          <p className="border-t px-4 py-2 text-xs text-destructive">
            {error} — 백엔드가 떠 있는지 확인하세요(NEXT_PUBLIC_API_BASE).
          </p>
        )}
      </section>

      {/* 실측 스펙 */}
      <section className="rounded-xl border bg-card">
        <header className="border-b px-4 py-2 text-sm font-semibold">
          모델 스펙 <span className="font-normal text-muted-foreground">· 2026-07-02 실호출 검증</span>
        </header>
        <dl className="grid gap-px bg-border sm:grid-cols-2">
          {FACTS.map((f) => (
            <div key={f.label} className="bg-card px-4 py-3">
              <dt className="text-xs text-muted-foreground">{f.label}</dt>
              <dd className="mt-0.5 break-all font-mono text-sm font-medium">{f.value}</dd>
              {f.note && <dd className="mt-0.5 text-xs text-muted-foreground">{f.note}</dd>}
            </div>
          ))}
        </dl>
      </section>

      {/* 어디에 쓰이나 */}
      <section className="rounded-xl border bg-card">
        <header className="border-b px-4 py-2 text-sm font-semibold">서비스 내 사용처</header>
        <ul className="divide-y">
          {USAGES.map((u) => (
            <li key={u.title} className="flex items-start gap-3 px-4 py-3">
              <u.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">{u.title}</p>
                <p className="text-xs text-muted-foreground">{u.desc}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* 컴플라이언스 */}
      <section className="flex items-start gap-3 rounded-xl border border-brand-green/30 bg-brand-green/5 px-4 py-3">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand-green" />
        <div className="text-sm">
          <p className="font-medium">국내 AI 트랙 100% 충족</p>
          <p className="mt-0.5 text-muted-foreground">
            추론·임베딩·function-calling 전 경로가 국산(Upstage) 단독. 외산 모델 호출이
            제품 경로에 없습니다. API 키는 서버 <code className="font-mono">.env</code> 시크릿으로만
            주입됩니다(repo·화면에 노출 없음).
          </p>
        </div>
      </section>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-0.5 truncate text-sm font-medium ${mono ? "font-mono" : ""}`} title={value}>
        {value}
      </p>
    </div>
  );
}

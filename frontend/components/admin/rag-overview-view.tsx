"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Cable,
  Database,
  FileText,
  Layers,
  MessageSquare,
  Power,
  RefreshCw,
  Scale,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import * as ragService from "@/services/rag";
import type { RagStats } from "@/services/rag";

/**
 * AI 코어 › RAG — 지식베이스가 무엇으로/얼마나 구성돼 있는지 조회 + 전역 ON/OFF.
 *
 * 세션별 연결/끊기(반영 연결하기·연결끊기)는 배선실(/admin/packaging)에서, 여기서는
 * "RAG 전체"의 구성 파악과 전역 스위치를 담당한다(백엔드 app_config.rag_enabled 영속).
 */

const SOURCE_KIND: Record<
  string,
  { label: string; desc: string; icon: React.ComponentType<{ className?: string }> }
> = {
  feedback: { label: "세무사 코멘트", desc: "검수 확정으로 실린 지식(제품이 자라는 원천)", icon: MessageSquare },
  case_seed: { label: "판례 시드", desc: "초기 구축 판례 코퍼스", icon: Scale },
  kb_document: { label: "큐레이션 문서", desc: "초기 구축 지식 문서", icon: FileText },
  conversation: { label: "대화 스냅샷", desc: "대화 단위 적재", icon: Layers },
};

function kindMeta(kind: string) {
  return (
    SOURCE_KIND[kind] ?? {
      label: kind,
      desc: "",
      icon: Database,
    }
  );
}

export function RagOverviewView() {
  const [stats, setStats] = useState<RagStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const s = await ragService.getRagStats();
      setStats(s);
      setError(null);
    } catch (e) {
      setStats(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const s = await ragService.getRagStats();
        if (!ignore) {
          setStats(s);
          setError(null);
        }
      } catch (e) {
        if (!ignore) {
          setStats(null);
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

  const onToggle = async () => {
    if (!stats) return;
    const next = !stats.ragEnabled;
    setToggling(true);
    setError(null);
    try {
      const res = await ragService.setRagEnabled(next);
      setStats({ ...stats, ragEnabled: res.ragEnabled, dbConfigured: res.dbConfigured });
      if (!res.dbConfigured) {
        setError("DB 미설정 — 토글이 영속되지 않았습니다(env RAG_ENABLED 로만 제어됨).");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setToggling(false);
    }
  };

  const on = stats?.ragEnabled ?? false;
  const seeded = (stats?.bySourceKind ?? []).filter(
    (k) => k.sourceKind === "case_seed" || k.sourceKind === "kb_document",
  );
  const grown = (stats?.bySourceKind ?? []).filter(
    (k) => k.sourceKind !== "case_seed" && k.sourceKind !== "kb_document",
  );

  return (
    <div className="flex flex-col gap-5 px-6 py-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Database className="size-6 text-brand-amber" />
            RAG — 지식베이스 구성
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            RAG 가 무엇으로 얼마나 구성돼 있는지 확인하고, 전역으로 켜고 끕니다. 세션별
            연결/끊기는{" "}
            <Link href="/admin/packaging" className="underline">
              배선실
            </Link>
            에서.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="size-3.5" />
          새로고침
        </Button>
      </header>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* 전역 ON/OFF */}
      <section
        className={cn(
          "rounded-xl border bg-card transition-colors",
          on ? "border-brand-green/40" : "border-border",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-start gap-3">
            <Power className={cn("mt-0.5 size-6", on ? "text-brand-green" : "text-muted-foreground")} />
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold">
                RAG 전역
                <Badge variant={on ? "default" : "secondary"}>{on ? "ON" : "OFF"}</Badge>
              </p>
              <p className="mt-0.5 max-w-lg text-xs text-muted-foreground">
                {on
                  ? "상담 답변에 KB 근거를 증강합니다. 끄면 baseline(근거 없이) 응답 — A/B 임팩트 측정용."
                  : "현재 baseline 모드 — 검색 근거 없이 규칙엔진만으로 응답합니다."}
                {stats && !stats.dbConfigured && " (DB 미설정: env 로만 제어)"}
              </p>
            </div>
          </div>
          <Switch on={on} disabled={loading || toggling || !stats} onClick={() => void onToggle()} />
        </div>
      </section>

      {/* 구성 요약 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="살아있는 passage" value={stats?.totalActive} loading={loading} accent />
        <Stat label="연결끊김" value={stats?.totalRetired} loading={loading} />
        <Stat label="기여 대화" value={stats?.conversations} loading={loading} />
        <Stat label="기여 세무사" value={stats?.auditors} loading={loading} />
      </div>

      {/* source_kind 분포 */}
      <section className="rounded-xl border bg-card">
        <header className="border-b px-4 py-2 text-sm font-semibold">구성 소스 (활성 기준)</header>
        {loading ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">로딩 중…</p>
        ) : (stats?.bySourceKind.length ?? 0) === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            아직 RAG 에 실린 데이터가 없습니다. <span className="font-medium">빈 RAG 로 출발</span>해
            검수 확정 코멘트로 자랍니다.
          </p>
        ) : (
          <>
            {seeded.length > 0 && (
              <KindGroup title="초기 구축" kinds={seeded} total={stats!.totalActive} />
            )}
            {grown.length > 0 && (
              <KindGroup title="검수로 성장" kinds={grown} total={stats!.totalActive} />
            )}
          </>
        )}
      </section>

      {/* 제품 논지 */}
      <section className="flex items-start gap-3 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
        <Sparkles className="mt-0.5 size-4 shrink-0" />
        <p>
          이 KB 는 세무사 코멘트로 자랍니다 — <span className="font-medium text-foreground">빈 RAG 로 출발</span>해
          검수 확정 때만 인정 코멘트가 적재됩니다(임베딩은 Upstage <code className="font-mono">embedding-passage</code>).
          연결을 끊으면 검색에서 빠지고 그 세무사 기여도도 자동 감소합니다.{" "}
          <Link href="/admin/packaging" className="inline-flex items-center gap-1 underline">
            <Cable className="size-3" /> 배선실에서 세션별로 추적
          </Link>
          .
        </p>
      </section>
    </div>
  );
}

function Switch({ on, disabled, onClick }: { on: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        on ? "bg-brand-green" : "bg-muted-foreground/30",
      )}
    >
      <span
        className={cn(
          "inline-block size-5 transform rounded-full bg-white shadow transition-transform",
          on ? "translate-x-6" : "translate-x-1",
        )}
      />
    </button>
  );
}

function Stat({
  label,
  value,
  loading,
  accent,
}: {
  label: string;
  value?: number;
  loading?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-bold tabular-nums", accent && "text-brand-green")}>
        {loading || value === undefined ? "—" : value}
      </p>
    </div>
  );
}

function KindGroup({
  title,
  kinds,
  total,
}: {
  title: string;
  kinds: { sourceKind: string; count: number }[];
  total: number;
}) {
  return (
    <div className="border-b last:border-b-0">
      <p className="px-4 pt-3 text-xs font-medium text-muted-foreground">{title}</p>
      <ul className="divide-y">
        {kinds.map((k) => {
          const meta = kindMeta(k.sourceKind);
          const pct = total > 0 ? Math.round((k.count / total) * 100) : 0;
          return (
            <li key={k.sourceKind} className="flex items-center gap-3 px-4 py-3">
              <meta.icon className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {meta.label}{" "}
                  <span className="font-mono text-xs text-muted-foreground">{k.sourceKind}</span>
                </p>
                {meta.desc && <p className="truncate text-xs text-muted-foreground">{meta.desc}</p>}
              </div>
              <div className="text-right">
                <p className="text-sm font-bold tabular-nums">{k.count}</p>
                <p className="text-xs text-muted-foreground">{pct}%</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

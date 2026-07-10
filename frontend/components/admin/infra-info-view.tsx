"use client";

import { useEffect, useState } from "react";
import {
  Cloud,
  Database,
  Globe,
  RefreshCw,
  Server,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import * as ragService from "@/services/rag";

/**
 * AI 코어 › 인프라 — 이 서비스를 작동시키는 프론트/백엔드/DB 배포 구성.
 * 정적 토폴로지(project_deployment_plan)는 상수로, 백엔드/DB 도달 여부는 라이브로.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "(미설정)";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "(미설정)";
const CHAT_MODE = process.env.NEXT_PUBLIC_CHAT_MODE ?? "(미설정)";

type Row = { k: string; v: string; mono?: boolean };

const FRONTEND: Row[] = [
  { k: "호스팅", v: "Vercel" },
  { k: "프로덕션 도메인", v: "neo-luddite.vercel.app", mono: true },
  { k: "repo", v: "sanolamian12/neo-luddite", mono: true },
  { k: "Root Directory", v: "frontend", mono: true },
  { k: "프로덕션 브랜치", v: "main", mono: true },
  { k: "프레임워크", v: "Next.js" },
];

const BACKEND: Row[] = [
  { k: "호스팅", v: "Oracle Cloud Always Free" },
  { k: "리전", v: "도쿄 (ap-tokyo-1)" },
  { k: "shape", v: "VM.Standard.E2.1.Micro · AMD 1GB + swap 2GB", mono: true },
  { k: "도메인(HTTPS)", v: "132-145-115-166.sslip.io", mono: true },
  { k: "공인 IP", v: "132.145.115.166", mono: true },
  { k: "구동", v: "systemd neo-luddite-api · uvicorn --workers 1", mono: true },
  { k: "TLS", v: "Caddy 자동 HTTPS (Let's Encrypt)" },
];

const DATABASE: Row[] = [
  { k: "호스팅", v: "Supabase (도쿄)" },
  { k: "엔진", v: "Postgres + pgvector" },
  { k: "RAG", v: "rag.passages (벡터) · rag.match_passages", mono: true },
  { k: "인증", v: "Supabase Auth — 역할(관리자/세무사/손님)" },
];

const ENV_FRONT: Row[] = [
  { k: "NEXT_PUBLIC_API_BASE", v: API_BASE, mono: true },
  { k: "NEXT_PUBLIC_SUPABASE_URL", v: SUPABASE_URL, mono: true },
  { k: "NEXT_PUBLIC_CHAT_MODE", v: CHAT_MODE, mono: true },
  { k: "NEXT_PUBLIC_SUPABASE_ANON_KEY", v: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "설정됨" : "미설정" },
];

const ENV_BACK: Row[] = [
  { k: "SUPABASE_DB_URL", v: "시크릿 (서버 .env)" },
  { k: "UPSTAGE_API_KEY", v: "시크릿 (서버 .env)" },
  { k: "CORS_ORIGINS", v: "neo-luddite.vercel.app, localhost:3000", mono: true },
  { k: "RAG_ENABLED", v: "폴백 기본값 (app_config 우선)", mono: true },
];

export function InfraInfoView() {
  const [backendUp, setBackendUp] = useState<boolean | null>(null);
  const [dbUp, setDbUp] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [h, r] = await Promise.allSettled([
      ragService.getServiceHealth(),
      ragService.getRagHealth(),
    ]);
    setBackendUp(h.status === "fulfilled" && h.value.ok);
    setDbUp(r.status === "fulfilled" ? r.value.dbConfigured : null);
    setLoading(false);
  };

  useEffect(() => {
    let ignore = false;
    (async () => {
      const [h, r] = await Promise.allSettled([
        ragService.getServiceHealth(),
        ragService.getRagHealth(),
      ]);
      if (ignore) return;
      setBackendUp(h.status === "fulfilled" && h.value.ok);
      setDbUp(r.status === "fulfilled" ? r.value.dbConfigured : null);
      setLoading(false);
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
            <Server className="size-6 text-brand-amber" />
            인프라 — 배포 구성
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            이 서비스를 작동시키는 프론트·백엔드·DB·LLM 구성. 라이브 도달 여부는 실시간으로
            확인합니다.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="size-3.5" />
          새로고침
        </Button>
      </header>

      {/* 라이브 도달 */}
      <div className="grid grid-cols-2 gap-3">
        <LiveTile label="백엔드 (Seam A)" up={backendUp} loading={loading} />
        <LiveTile label="데이터베이스 (Supabase)" up={dbUp} loading={loading} />
      </div>

      <ServiceCard icon={Globe} title="프론트엔드" badge="Vercel" rows={FRONTEND} />
      <ServiceCard icon={Cloud} title="백엔드 (Seam A · FastAPI)" badge="Oracle 도쿄" rows={BACKEND} />
      <ServiceCard icon={Database} title="데이터베이스" badge="Supabase" rows={DATABASE} />

      <section className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <Sparkles className="size-5 text-brand-amber" />
          <div>
            <p className="text-sm font-medium">LLM / 임베딩</p>
            <p className="text-xs text-muted-foreground">Upstage Solar — 상세는 LLM 탭</p>
          </div>
        </div>
        <Badge variant="outline">국산 단독</Badge>
      </section>

      {/* 환경변수 */}
      <section className="grid gap-3 md:grid-cols-2">
        <EnvCard title="프론트 환경변수 (Vercel)" rows={ENV_FRONT} />
        <EnvCard title="백엔드 환경변수 (서버 .env)" rows={ENV_BACK} />
      </section>

      {/* 리스크 */}
      <section className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-600" />
        <div>
          <p className="font-medium">알려진 리스크 — OCI 공인 IP는 ephemeral</p>
          <p className="mt-0.5 text-muted-foreground">
            인스턴스 stop/start 시 IP가 바뀌면 sslip.io 도메인·API_BASE·인증서가 깨집니다.
            영구화하려면 Reserved Public IP 승격 필요(현재 팀 테스트 중이라 보류).
          </p>
        </div>
      </section>
    </div>
  );
}

function LiveTile({ label, up, loading }: { label: string; up: boolean | null; loading?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border bg-card px-4 py-3">
      <span className="text-sm font-medium">{label}</span>
      {loading ? (
        <Badge variant="outline">확인 중…</Badge>
      ) : up ? (
        <Badge variant="default">도달</Badge>
      ) : up === false ? (
        <Badge variant="destructive">응답 없음</Badge>
      ) : (
        <Badge variant="secondary">미설정</Badge>
      )}
    </div>
  );
}

function ServiceCard({
  icon: Icon,
  title,
  badge,
  rows,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  badge: string;
  rows: Row[];
}) {
  return (
    <section className="rounded-xl border bg-card">
      <header className="flex items-center justify-between gap-2 border-b px-4 py-2">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="size-4 text-muted-foreground" />
          {title}
        </span>
        <Badge variant="outline">{badge}</Badge>
      </header>
      <dl className="grid gap-px bg-border sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.k} className="bg-card px-4 py-2.5">
            <dt className="text-xs text-muted-foreground">{r.k}</dt>
            <dd className={`mt-0.5 break-all text-sm font-medium ${r.mono ? "font-mono" : ""}`}>
              {r.v}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function EnvCard({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <section className="rounded-xl border bg-card">
      <header className="border-b px-4 py-2 text-sm font-semibold">{title}</header>
      <ul className="divide-y text-sm">
        {rows.map((r) => (
          <li key={r.k} className="flex flex-col gap-0.5 px-4 py-2">
            <span className="font-mono text-xs text-muted-foreground">{r.k}</span>
            <span className={`break-all ${r.mono ? "font-mono text-xs" : ""}`}>{r.v}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

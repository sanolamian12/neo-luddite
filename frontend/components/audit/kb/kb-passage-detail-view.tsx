"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/poc-format";
import * as ragService from "@/services/rag";
import type { PassageInfo, PassageNeighbor } from "@/services/rag";

/**
 * KB 지식망 상세뷰 — passage 하나를 중심에 두고, 조회 시점에 계산한 코사인 유사도 이웃을
 * 방사형(거미줄)으로 펼친다. 저장된 그래프가 아니라 "지금 이 passage 와 가장 가까운 것"을
 * 매번 새로 재는 국소 그래프다(구조 분석 2026-08-27) — 전체를 한 번에 그리지 않아 KB 가
 * 커져도(exact scan) 비용이 늘지 않는다. 이웃을 클릭하면 그 이웃을 중심으로 다시 펼쳐져
 * 탐색형으로 KB 를 따라갈 수 있다.
 */

const CENTER = 260;
const MIN_R = 90;
const MAX_R = 220;

function radiusFor(score: number): number {
  const clamped = Math.min(1, Math.max(0, score));
  return MIN_R + (1 - clamped) * (MAX_R - MIN_R);
}

export function KbPassageDetailView({ passageId }: { passageId: string }) {
  const router = useRouter();
  const [center, setCenter] = useState<PassageInfo | null | undefined>(undefined);
  const [neighbors, setNeighbors] = useState<PassageNeighbor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hovered, setHovered] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [all, nb] = await Promise.all([
        ragService.listPassages(),
        ragService.getPassageNeighbors(passageId, 8),
      ]);
      setCenter(all.find((p) => p.id === passageId) ?? null);
      setNeighbors(nb.neighbors);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setNeighbors([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let ignore = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [all, nb] = await Promise.all([
          ragService.listPassages(),
          ragService.getPassageNeighbors(passageId, 8),
        ]);
        if (!ignore) {
          setCenter(all.find((p) => p.id === passageId) ?? null);
          setNeighbors(nb.neighbors);
        }
      } catch (e) {
        if (!ignore) {
          setError(e instanceof Error ? e.message : String(e));
          setNeighbors([]);
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passageId]);

  return (
    <div className="flex flex-col gap-5 px-6 py-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <Link
            href="/audit/kb-map"
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
          >
            <ArrowLeft className="size-3" />
            지식망으로
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">유사도 이웃</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            이 항목과 지금 KB 안에서 가장 유사한 항목들입니다(코사인 유사도, 조회 시점 계산).
            이웃을 클릭하면 그 이웃을 중심으로 다시 펼쳐집니다.
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

      {loading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">로딩 중…</p>
      ) : center === null ? (
        <p className="rounded-xl border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
          이 passage 를 찾을 수 없습니다(연결끊김/삭제됐을 수 있음).
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_1fr]">
          {/* 방사형(거미줄) 유사도 네트워크 */}
          <div className="rounded-xl border bg-card p-2">
            <svg viewBox="0 0 520 520" className="mx-auto w-full max-w-[520px]" role="img" aria-label="유사도 네트워크">
              {(neighbors ?? []).map((n) => {
                const idx = (neighbors ?? []).indexOf(n);
                const total = (neighbors ?? []).length || 1;
                const angle = (idx / total) * Math.PI * 2 - Math.PI / 2;
                const r = radiusFor(n.score);
                const x = CENTER + r * Math.cos(angle);
                const y = CENTER + r * Math.sin(angle);
                const isHovered = hovered === n.id;
                return (
                  <g key={n.id}>
                    <line
                      x1={CENTER}
                      y1={CENTER}
                      x2={x}
                      y2={y}
                      stroke="currentColor"
                      strokeOpacity={0.15 + n.score * 0.35}
                      strokeWidth={isHovered ? 2 : 1}
                      className="text-brand-green"
                    />
                    <g
                      className="cursor-pointer"
                      onMouseEnter={() => setHovered(n.id)}
                      onMouseLeave={() => setHovered((h) => (h === n.id ? null : h))}
                      onClick={() => router.push(`/audit/kb-map/${encodeURIComponent(n.id)}`)}
                    >
                      <circle
                        cx={x}
                        cy={y}
                        r={isHovered ? 16 : 12}
                        className="fill-brand-green/80 stroke-background transition-all"
                        strokeWidth={2}
                      />
                      <text
                        x={x}
                        y={y + 28}
                        textAnchor="middle"
                        className="fill-muted-foreground text-[10px]"
                      >
                        {Math.round(n.score * 100)}%
                      </text>
                    </g>
                  </g>
                );
              })}
              {/* 중심 노드 */}
              <circle cx={CENTER} cy={CENTER} r={22} className="fill-brand-amber stroke-background" strokeWidth={3} />
              <text x={CENTER} y={CENTER + 4} textAnchor="middle" className="fill-background text-[11px] font-bold">
                중심
              </text>
            </svg>
            {hovered && (
              <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                {(neighbors ?? []).find((n) => n.id === hovered)?.content.slice(0, 160)}
              </p>
            )}
            {(neighbors ?? []).length === 0 && (
              <p className="px-3 py-2 text-center text-xs text-muted-foreground">
                유사한 다른 항목이 아직 없습니다.
              </p>
            )}
          </div>

          {/* 중심 passage 상세 + 이웃 목록 */}
          <div className="flex flex-col gap-3">
            {center && (
              <section className="rounded-xl border border-brand-amber/40 bg-card p-4">
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="text-[10px]">{center.sourceKind}</Badge>
                  {center.taxCategory && <Badge variant="secondary" className="text-[10px]">{center.taxCategory}</Badge>}
                  {center.occupation && <Badge variant="secondary" className="text-[10px]">{center.occupation}</Badge>}
                  {center.status === "retired" && <Badge variant="destructive" className="text-[10px]">연결끊김</Badge>}
                  <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(center.createdAt)}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm">{center.content}</p>
                <p className="mt-2 text-xs text-muted-foreground">{center.reviewer ?? center.auditorId ?? "—"}</p>
              </section>
            )}

            <section className="rounded-xl border bg-card">
              <header className="border-b px-4 py-2 text-sm font-semibold">
                유사도 이웃 {neighbors ? `(${neighbors.length})` : ""}
              </header>
              <ul className="divide-y">
                {(neighbors ?? [])
                  .slice()
                  .sort((a, b) => b.score - a.score)
                  .map((n) => (
                    <li key={n.id}>
                      <Link
                        href={`/audit/kb-map/${encodeURIComponent(n.id)}`}
                        onMouseEnter={() => setHovered(n.id)}
                        onMouseLeave={() => setHovered((h) => (h === n.id ? null : h))}
                        className="flex flex-col gap-1 px-4 py-2.5 hover:bg-muted/30"
                      >
                        <div className="flex items-center gap-2">
                          <Badge variant="default" className="text-[10px]">
                            {Math.round(n.score * 100)}%
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">{n.sourceKind}</Badge>
                          {n.taxCategory && <span className="text-xs text-muted-foreground">{n.taxCategory}</span>}
                        </div>
                        <p className="line-clamp-1 text-sm">{n.content}</p>
                      </Link>
                    </li>
                  ))}
              </ul>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Archive, CalendarClock, Sparkles, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/poc-format";
import * as kb2Service from "@/services/kb2";
import type { Kb2CategorySynthesisResult, Kb2Document, Kb2Job } from "@/services/kb2";

const STAGE_LABEL: Record<Kb2Job["stage"], string> = {
  scheduled: "예약됨 — 실행 대기 중",
  cancelled: "예약 취소됨",
  discovering_categories: "RAG 전체 분석 중 — 카테고리 후보 발견",
  classifying_passages: "패시지 분류 중",
  synthesizing: "카테고리별 문장 합성 중",
  done: "완료",
};

/** 단계마다 진행률의 단위가 다르다 — 분류 단계는 배치(2026-09-10 배치화), 합성 단계는
 * 카테고리. 예전엔 둘 다 "카테고리"로 찍혀 분류 중에는 숫자가 사실과 달랐다. */
const PROGRESS_UNIT: Partial<Record<Kb2Job["stage"], string>> = {
  classifying_passages: "배치",
  synthesizing: "카테고리",
};

/** 다음 새벽 3시(브라우저 로컬=KST) epoch ms. 서버는 도쿄 박스라 시각 계산을 서버에
 * 맡기면 의도와 어긋날 수 있어 여기서 계산해 보낸다. */
function nextNightlyRunAt(): number {
  const at = new Date();
  at.setHours(3, 0, 0, 0);
  if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
  return at.getTime();
}

/** AI로 카테고리 재구조화 — Solar Pro가 그 시점 RAG 전체를 분석해 카테고리 자체를 새로
 * 제안한다(로드맵 4.5단계). 완료되면 이전 활성 문서·카테고리는 전부 보관 처리된다.
 *
 * 기본 동작은 "야간 배치 예약"이다(2026-09-10) — 활성 passage 전량을 LLM에 태우는
 * 작업이라 근무 시간 중 즉시 실행이 부적절하다는 지적을 반영. 즉시 실행도 남겨두되
 * 확정 버튼 확인형으로 한 단계 막아둔다(세목→대목 이동에서 쓴 것과 같은 패턴). */
function Kb2RestructureSection() {
  const [starting, setStarting] = useState(false);
  const [job, setJob] = useState<Kb2Job | null>(null);
  const [scheduled, setScheduled] = useState<Kb2Job[]>([]);
  const [confirmingNow, setConfirmingNow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archived, setArchived] = useState<Kb2Document[] | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshScheduled = () =>
    kb2Service
      .listKb2ScheduledJobs()
      .then(({ jobs }) => setScheduled(jobs))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

  useEffect(() => {
    // 예약은 DB에 있으므로 브라우저를 닫았다 열어도, 백엔드가 재시작돼도 남아있다.
    void refreshScheduled();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const poll = (jobId: string) => {
    pollRef.current = setInterval(() => {
      kb2Service
        .getKb2RestructureJob(jobId)
        .then(({ job: j }) => {
          if (!j) return;
          setJob(j);
          if (j.status !== "running" && pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : String(e));
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        });
    }, 3000);
  };

  /** scheduleAt 없으면 즉시 실행 + 폴링, 있으면 예약만 걸고 예약 목록 갱신. */
  const start = async (scheduleAt?: number) => {
    setStarting(true);
    setError(null);
    setConfirmingNow(false);
    setJob(null);
    try {
      const { jobId } = await kb2Service.startKb2Restructure(scheduleAt);
      if (!jobId) setError("작업을 시작할 수 없습니다(DB 미설정).");
      else if (scheduleAt) await refreshScheduled();
      else poll(jobId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  const cancelSchedule = async (jobId: string) => {
    setError(null);
    try {
      const { cancelled } = await kb2Service.cancelKb2ScheduledJob(jobId);
      if (!cancelled) setError("이미 실행에 들어가 취소할 수 없습니다.");
      await refreshScheduled();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggleArchive = async () => {
    const next = !showArchive;
    setShowArchive(next);
    if (next && archived === null) {
      try {
        const { documents } = await kb2Service.listArchivedKb2Documents();
        setArchived(documents);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  };

  const running = job?.status === "running";

  return (
    <section className="rounded-xl border border-brand-green/30 bg-brand-green/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Wand2 className="size-5 text-brand-green" />
            AI로 카테고리 재구조화
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            지금 시점 RAG 전체를 Solar Pro가 다시 분석해 카테고리 자체를 새로 제안합니다
            (고정 17개 세목 대체). 활성 문답 전량을 LLM에 태우는 큰 작업이라 기본은
            <strong className="text-foreground"> 야간 배치 예약</strong>입니다 — 근무
            시간에는 예약만 걸어두세요. 완료되면 이전 활성 문서·카테고리는 전부 보관
            처리됩니다(삭제 아님).
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Button onClick={() => void start(nextNightlyRunAt())} disabled={starting || running}>
            <CalendarClock className="size-3.5" />
            오늘 밤 {formatDateTime(nextNightlyRunAt())} 실행 예약
          </Button>
          {confirmingNow ? (
            <div className="flex items-center gap-1.5">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void start()}
                disabled={starting || running}
              >
                <Wand2 className="size-3.5" />
                지금 실행 확정
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmingNow(false)}>
                취소
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmingNow(true)}
              disabled={starting || running}
            >
              <Wand2 className="size-3.5" />
              {running ? "재구조화 중…" : "지금 즉시 실행"}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {scheduled.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5 rounded-md border border-brand-green/30 bg-card px-3 py-2.5 text-sm">
          {scheduled.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <CalendarClock className="size-4 text-brand-green" />
                {s.scheduledAt ? formatDateTime(s.scheduledAt) : "—"} 실행 예약됨
              </span>
              <Button variant="ghost" size="sm" onClick={() => void cancelSchedule(s.id)}>
                예약 취소
              </Button>
            </div>
          ))}
        </div>
      )}

      {job && (
        <div className="mt-3 rounded-md border bg-card px-3 py-2.5 text-sm">
          <p className="font-medium text-foreground">
            {job.status === "error" ? "실패" : STAGE_LABEL[job.stage]}
          </p>
          {job.status === "running" && job.totalCategories > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {job.completedCategories}/{job.totalCategories}{" "}
              {PROGRESS_UNIT[job.stage] ?? "단계"} 처리됨
            </p>
          )}
          {job.status === "done" && job.result && (
            <p className="mt-1 text-xs text-muted-foreground">
              카테고리 {job.result.categoriesCreated ?? 0}개 생성 · 이전 문서{" "}
              {job.result.documentsArchived ?? 0}건 보관 처리
            </p>
          )}
          {job.status === "error" && (
            <p className="mt-1 text-xs text-destructive">{job.error}</p>
          )}
        </div>
      )}

      <Button variant="outline" size="sm" className="mt-3" onClick={() => void toggleArchive()}>
        <Archive className="size-3.5" />
        보관함{archived ? ` (${archived.length})` : ""}
      </Button>
      {showArchive && (
        <div className="mt-2 flex flex-col gap-1.5 rounded-md border border-dashed bg-muted/30 p-3">
          {archived === null ? (
            <p className="text-xs text-muted-foreground">불러오는 중…</p>
          ) : archived.length === 0 ? (
            <p className="text-xs text-muted-foreground">보관된 문서가 없습니다.</p>
          ) : (
            archived.map((d) => (
              <div key={d.id} className="flex items-center justify-between text-xs">
                <span>{d.taxCategory}</span>
                <span className="text-muted-foreground">{formatDateTime(d.updatedAt)}</span>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}

/**
 * 지식베이스2 합성 (설계 아티팩트 §02·§07, 2026-09-03) — admin 전용 트리거.
 *
 * "지금 시점 RAG로 지식베이스2 재구성" 버튼 하나. 세목(tax_category)별로
 * rag.passages(active) 를 Solar Pro 에 투입해 조항형 문장으로 응축, kb2.sentences
 * 를 재생성한다. locked_by_auditor=true 인 문장(세무사 수정분)은 건드리지 않는다
 * (그래서 재실행할수록 "lockedSkipped" 가 늘어나는 것이 정상 — 최신화 보호막).
 *
 * 이 화면은 auditor 사이드바에는 없다 — /admin 라우트에만 있어 RoleGuard(admin)
 * 로만 보호된다(이 저장소의 기존 admin 전용 컨벤션).
 */
export function Kb2SynthesisView() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Kb2CategorySynthesisResult[] | null>(null);
  const [dbConfigured, setDbConfigured] = useState(true);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await kb2Service.synthesizeKb2();
      setResults(res.results);
      setDbConfigured(res.dbConfigured);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const totalCreated = (results ?? []).reduce((sum, r) => sum + r.created, 0);
  const totalLocked = (results ?? []).reduce((sum, r) => sum + r.lockedSkipped, 0);
  const touched = (results ?? []).filter((r) => r.documentId !== null);

  return (
    <div className="flex flex-col gap-5 px-6 py-6">
      <Kb2RestructureSection />

      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Sparkles className="size-6 text-brand-amber" />
            지식베이스2 합성 (레거시)
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            고정 17개 세목 기준 합성 — 위 &quot;AI로 카테고리 재구조화&quot; 사용을
            권장합니다. 버튼을 누르면 지금 시점 RAG(활성 상태인 질문/답변/코멘트 묶음)를
            세목별로 모아 Solar Pro 가 조항형 단문 사전으로 응축합니다. 세무사가 이미
            수정한 문장은 재실행해도 그대로 보호됩니다.
          </p>
        </div>
        <Button variant="outline" onClick={() => void run()} disabled={busy}>
          <Sparkles className="size-3.5" />
          {busy ? "합성 중…" : "지금 RAG로 지식베이스2 재구성"}
        </Button>
      </header>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {!dbConfigured && results && (
        <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
          <AlertTriangle className="size-4" />
          RAG DB 미설정 — 합성을 실행할 수 없습니다.
        </div>
      )}

      {results && dbConfigured && (
        <>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">생성/갱신 문장 {totalCreated}건</Badge>
            <Badge variant="outline">보호된(수정됨) 문장 {totalLocked}건</Badge>
            <Badge variant="outline">{touched.length}개 세목 반영</Badge>
          </div>

          {touched.length === 0 ? (
            <div className="rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
              반영된 세목이 없습니다. RAG에 활성 passage가 쌓이면 다시 실행해보세요.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">세목</th>
                    <th className="px-4 py-2 text-right font-medium">생성 문장</th>
                    <th className="px-4 py-2 text-right font-medium">보호(수정됨)</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {touched.map((r) => (
                    <tr key={r.taxCategory}>
                      <td className="px-4 py-2">{r.taxCategory}</td>
                      <td className="px-4 py-2 text-right font-mono">{r.created}</td>
                      <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                        {r.lockedSkipped}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

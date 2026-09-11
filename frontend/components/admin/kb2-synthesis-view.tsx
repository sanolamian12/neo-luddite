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
  merging_categories: "카테고리 후보 통합 중",
  classifying_passages: "패시지 분류 중",
  synthesizing: "카테고리별 문장 합성 중",
  storing_unsorted: "분류 안 된 상담을 '기타'에 보관 중",
  done: "완료",
  aborted: "중단됨 — 기존 세대를 지켰습니다",
};

/** 단계마다 진행률의 단위가 다르다 — 맵·분류 단계는 배치(2026-09-10 배치화), 합성
 * 단계는 카테고리. 예전엔 둘 다 "카테고리"로 찍혀 분류 중에는 숫자가 사실과 달랐다. */
const PROGRESS_UNIT: Partial<Record<Kb2Job["stage"], string>> = {
  discovering_categories: "배치",
  classifying_passages: "건",
  synthesizing: "카테고리",
  storing_unsorted: "건",
};

/** 다음 새벽 3시(브라우저 로컬=KST) epoch ms. 서버는 도쿄 박스라 시각 계산을 서버에
 * 맡기면 의도와 어긋날 수 있어 여기서 계산해 보낸다. */
function nextNightlyRunAt(): number {
  const at = new Date();
  at.setHours(3, 0, 0, 0);
  if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
  return at.getTime();
}

/** 커버리지 깔때기(2026-09-11). KB2 가 원본 RAG 의 몇 %를 실제로 담았는지, 그리고
 * 어느 단계에서 원문이 새는지 보여준다 — 이게 없던 동안은 "커버리지 20%"를 발견하고도
 * 원인이 분류인지 합성인지 가릴 수 없었다(분류 결과를 저장하지 않아 측정 자체가 불가).
 * 세 지점을 나란히 둔 이유: 미분류가 크면 카테고리가 좁은 것이고, 투입 못 한 수가
 * 크면 반대로 카테고리가 커서 프롬프트 예산에 밀린 것이라 처방이 정반대다. */
/** 나쁜 회차 가드가 적재를 막았을 때 그 근거를 보여준다(2026-09-11).
 *
 * 여기서 제일 중요한 한 줄은 "기존 세대는 그대로다"이다 — 재구조화가 실패했다는 화면을
 * 보면 KB 가 비었을까 봐 놀라게 되는데, 가드는 정확히 그 반대를 한 것이다. 숫자(이번
 * 배정률 vs 직전 세대 vs 요구치)를 같이 두는 이유는 "다시 돌린다"와 "목차를 손본다"
 * 중 무엇을 할지가 그 비교에서 갈리기 때문이다. */
function RunGuardNotice({ guard }: { guard: kb2Service.Kb2RunGuard }) {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  return (
    <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5">
      <p className="text-xs font-medium text-foreground">{guard.reason}</p>
      <dl className="mt-1.5 flex flex-col gap-0.5">
        <div className="flex justify-between gap-2 text-xs text-muted-foreground">
          <dt>이번 회차 배정률</dt>
          <dd className="tabular-nums">
            {guard.assigned}/{guard.passagesTotal}건 ({pct(guard.assignedRatio)})
          </dd>
        </div>
        <div className="flex justify-between gap-2 text-xs text-muted-foreground">
          <dt>직전 세대 배정률</dt>
          <dd className="tabular-nums">
            {guard.baselineAssignedRatio === null
              ? "기준선 없음 (절대 하한만 적용)"
              : pct(guard.baselineAssignedRatio)}
          </dd>
        </div>
        <div className="flex justify-between gap-2 text-xs text-muted-foreground">
          <dt>통과에 필요한 배정률</dt>
          <dd className="tabular-nums">{pct(guard.requiredRatio)}</dd>
        </div>
        <div className="flex justify-between gap-2 text-xs text-muted-foreground">
          <dt>분류 호출 실패</dt>
          <dd className="tabular-nums">
            {guard.classifyFailures}건
            {guard.classifyFailures > 0 &&
              ` (${Object.entries(guard.classifyFailureKinds)
                .map(([kind, n]) => `${kind} ${n}`)
                .join(", ")})`}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function CoverageFunnel({
  coverage,
  stats,
}: {
  coverage: kb2Service.Kb2Coverage;
  stats: kb2Service.Kb2CategoryStat[];
}) {
  const [open, setOpen] = useState(false);
  const pct = (n: number) =>
    coverage.passagesTotal ? `${Math.round((n / coverage.passagesTotal) * 100)}%` : "—";
  const rows: Array<[string, string]> = [
    ["원본 활성 passage", `${coverage.passagesTotal}건`],
    ["세목에 배정", `${coverage.assigned}건 (${pct(coverage.assigned)})`],
    // '기타' 도입(0025) 이후로 미분류는 **유실이 아니라 보관**이다 — 검색에는 안
    // 들어가지만 트리에 남아 세무사가 옮길 수 있다. 보관된 건수가 있으면 그렇게 읽힌다.
    (coverage.unsortedStored ?? 0) > 0
      ? [
          "미분류 → '기타' 보관",
          `${coverage.unclassified}건 (${pct(coverage.unclassified)}) · 검색 제외`,
        ]
      : ["미분류로 유실", `${coverage.unclassified}건 (${pct(coverage.unclassified)})`],
    ["합성 프롬프트 투입", `${coverage.fed}건 (${pct(coverage.fed)})`],
    ["예산에 밀려 미투입", `${coverage.truncated}건 (${pct(coverage.truncated)})`],
    ["문장 근거로 인용", `${coverage.cited}건 (${pct(coverage.cited)})`],
  ];
  return (
    <div className="mt-2 rounded-md border border-dashed bg-muted/30 p-2.5">
      <p className="text-xs font-medium text-foreground">
        커버리지 {Math.round(coverage.citedRatio * 100)}% — 원본 {coverage.passagesTotal}건 중{" "}
        {coverage.cited}건이 KB2 문장의 근거로 반영됨
      </p>
      <dl className="mt-1.5 flex flex-col gap-0.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2 text-xs text-muted-foreground">
            <dt>{label}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        분류 호출 {coverage.classifyCalls}회 · 합성 호출 {coverage.synthesisChunks}회 · 문장{" "}
        {coverage.sentences}개 · 환각 출처 id 제거 {coverage.hallucinatedIdsDropped}개
      </p>
      {/* 분류는 번들 전체가 아니라 [질문]만 읽는다(2026-09-11). 파서가 실패하면 조용히
          번들 전체로 되돌아가므로, 되돌아간 건수가 있으면 반드시 보여준다 — 그만큼은
          커버리지가 12%p 나쁜 옛 입력으로 분류됐다는 뜻이다. */}
      {(coverage.classifyInputFallbacks ?? 0) > 0 && (
        <p className="mt-1 text-[11px] text-destructive">
          분류 입력 폴백 {coverage.classifyInputFallbacks}건 — 번들에서 [질문]을 찾지 못해
          번들 전체로 분류했습니다. 번들 형식이 바뀌었는지 확인하세요
        </p>
      )}
      {/* 0 일 때는 굳이 안 띄운다 — 평시 값이라 늘 보이면 눈에서 사라진다. */}
      {(coverage.classifyFailures ?? 0) > 0 && (
        <p className="mt-1 text-[11px] text-destructive">
          분류 호출 실패 {coverage.classifyFailures}건 — 그만큼은 모델이 &apos;미분류&apos;로
          판단한 게 아니라 원문을 읽지 못한 것입니다
          {coverage.classifyFailureKinds &&
            ` (${Object.entries(coverage.classifyFailureKinds)
              .map(([kind, n]) => `${kind} ${n}`)
              .join(", ")})`}
        </p>
      )}
      {stats.length > 0 && (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 h-6 px-1.5 text-xs"
            onClick={() => setOpen((v) => !v)}
          >
            세목별 상세 {open ? "접기" : `보기 (${stats.length})`}
          </Button>
          {open && (
            <div className="mt-1 overflow-x-auto">
              <table className="w-full text-left text-[11px] tabular-nums">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="pr-2 font-normal">세목</th>
                    <th className="px-1 font-normal">배정</th>
                    <th className="px-1 font-normal">투입</th>
                    <th className="px-1 font-normal">미투입</th>
                    <th className="px-1 font-normal">청크</th>
                    <th className="px-1 font-normal">문장</th>
                    <th className="pl-1 font-normal">인용</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((s) => (
                    <tr key={s.label} className="border-t">
                      <td className="max-w-[10rem] truncate pr-2">{s.label}</td>
                      <td className="px-1">{s.assigned}</td>
                      <td className="px-1">{s.fed}</td>
                      <td className="px-1">{s.truncated}</td>
                      <td className="px-1">{s.chunks}</td>
                      <td className="px-1">{s.sentences}</td>
                      <td className="pl-1">{s.cited}</td>
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
    // 지난 회차 결과(=커버리지 계측)도 복원한다. job 은 원래 "실행을 건 탭이 폴링하는
    // 동안"에만 화면에 있었는데, 기본 실행 경로가 새벽 3시 예약이라 그 탭이 없다.
    void kb2Service
      .getLatestKb2RestructureJob()
      .then(({ job: j }) => setJob((cur) => cur ?? j))
      .catch(() => {});
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
            {/* 가드가 멈춘 회차는 "실패"가 아니다 — 의도대로 동작해 기존 세대를 지킨
                것이라, 같은 빨간 '실패'로 보이면 고쳐야 할 버그처럼 읽힌다. */}
            {job.status === "error" && job.stage !== "aborted"
              ? "실패"
              : STAGE_LABEL[job.stage]}
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
          {job.status === "done" && job.result?.coverage && (
            <CoverageFunnel
              coverage={job.result.coverage}
              stats={job.result.categoryStats ?? []}
            />
          )}
          {job.status === "error" && !job.result?.guard && (
            <p className="mt-1 text-xs text-destructive">{job.error}</p>
          )}
          {job.result?.guard && <RunGuardNotice guard={job.result.guard} />}
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

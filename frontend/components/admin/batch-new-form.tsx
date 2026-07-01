"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { usePipelineHydrated } from "@/lib/pipeline-store";
import { useAccountStore } from "@/lib/account-store";
import { conversations } from "@/lib/load-conversation";
import * as pipelineService from "@/services/pipeline";
import type { EligibleFeedback } from "@/services/pipeline";

function defaultLabel(): string {
  return `Batch-${new Date().toISOString().slice(0, 10)}`;
}

export function BatchNewForm() {
  const router = useRouter();
  const hydrated = usePipelineHydrated();
  const adminId = useAccountStore((s) => s.admin.id);

  const [eligible, setEligible] = useState<EligibleFeedback[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [label, setLabel] = useState(defaultLabel());
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    (async () => {
      const { items } = await pipelineService.listEligibleFeedbacks();
      if (!cancelled) {
        setEligible(items);
        setSelectedKeys(new Set(items.map(keyOf)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated]);

  const keyOf = (e: EligibleFeedback) => `${e.auditId}::${e.feedbackId}`;

  const toggle = (k: string) =>
    setSelectedKeys((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const selectedList = useMemo(
    () => eligible.filter((e) => selectedKeys.has(keyOf(e))),
    [eligible, selectedKeys],
  );
  const distinctAuditors = useMemo(() => {
    const s = new Set<string>();
    for (const e of selectedList) s.add(e.auditorId);
    return s.size;
  }, [selectedList]);

  const onCreate = async () => {
    setError(null);
    if (selectedList.length === 0) {
      setError("최소 1건 이상 선택해야 합니다.");
      return;
    }
    setSubmitting(true);
    try {
      const batch = await pipelineService.createBatch({
        label: label.trim() || defaultLabel(),
        acceptedFeedbacks: selectedList.map((e) => ({
          auditId: e.auditId,
          feedbackId: e.feedbackId,
        })),
        createdBy: adminId,
        notes: notes.trim() || undefined,
      });
      router.push(`/admin/pipeline/batches/${batch.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  if (!hydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }

  return (
    <div className="flex flex-col gap-6 px-6 py-6 max-w-4xl">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">새 Training Batch</h1>
        <Button variant="ghost" render={<Link href="/admin/pipeline/batches" />}>
          취소
        </Button>
      </div>

      <Section title="라벨">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="예: Batch-2026-07-병의원"
          className="h-9"
        />
      </Section>

      <Section title={`인정 피드백 선택 (${selectedList.length} / ${eligible.length})`}>
        <div className="overflow-hidden rounded-xl border bg-card">
          {eligible.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              묶을 수 있는 피드백이 없습니다. 검수를 더 진행해 보세요.
            </p>
          ) : (
            <ul className="divide-y">
              {eligible.map((e) => {
                const k = keyOf(e);
                const checked = selectedKeys.has(k);
                const conv = conversations[e.conversationId];
                return (
                  <li key={k} className="flex items-start gap-3 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(k)}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs">{e.feedbackId.slice(0, 12)}</span>
                        <Badge variant="outline">{e.auditorId}</Badge>
                        {conv && (
                          <span className="text-xs text-muted-foreground">
                            {conv.topic.title}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-sm">{e.body}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {selectedList.length > 0 && (
          <p className="text-xs text-muted-foreground">
            선택: {selectedList.length}건 · 평가자 {distinctAuditors}명
          </p>
        )}
      </Section>

      <Section title="메모 (선택)">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="이 batch 의 의도나 노트"
        />
      </Section>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" render={<Link href="/admin/pipeline/batches" />}>
          취소
        </Button>
        <Button onClick={onCreate} disabled={submitting || selectedList.length === 0}>
          {submitting ? "생성 중…" : "Batch 생성"}
        </Button>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

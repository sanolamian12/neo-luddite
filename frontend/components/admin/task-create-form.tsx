"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  useConversationHydrated,
  useConversationStore,
} from "@/lib/conversation-store";
import { useAuditTaskStore } from "@/lib/audit-task-store";
import { useAccountHydrated, useAccountStore } from "@/lib/account-store";
import { getOccupation } from "@/lib/occupations";
import { middleTruncate } from "@/lib/utils";
import * as auditTaskService from "@/services/audit-task";

const CAPACITY_OPTIONS = [1, 2, 3, 5, 10] as const;

export function TaskCreateForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const convHydrated = useConversationHydrated();
  const accountHydrated = useAccountHydrated();
  const records = useConversationStore((s) => s.records);
  const tasks = useAuditTaskStore((s) => s.tasks);
  const adminId = useAccountStore((s) => s.admin.id);

  const assignedIds = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) for (const cid of t.conversationIds) set.add(cid);
    return set;
  }, [tasks]);

  const preselected = useMemo(() => {
    const param = searchParams?.get("conversationIds");
    if (!param) return [] as string[];
    return param
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }, [searchParams]);

  const [selectedIds, setSelectedIds] = useState<string[]>(preselected);
  const [label, setLabel] = useState("");
  const [capacity, setCapacity] = useState<number>(3);
  const [deadlineStr, setDeadlineStr] = useState<string>(() => {
    const d = new Date(Date.now() + 7 * 86_400_000);
    return d.toISOString().slice(0, 10);
  });
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  // 하차장 후보 = 사진 찍힌(정지) & 미제외 대화. 라이브 진행 중은 제외.
  const eligibleCandidates = useMemo(
    () =>
      records
        .filter((c) => c.snapshotAt != null && c.excludedAt == null)
        .sort((a, b) => b.createdAt - a.createdAt),
    [records],
  );

  if (!convHydrated || !accountHydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }

  const onSubmit = async () => {
    setError(null);
    if (selectedIds.length === 0) {
      setError("최소 1개 이상의 대화를 선택해야 합니다.");
      return;
    }
    if (capacity < 1) {
      setError("모집 인원은 1 이상이어야 합니다.");
      return;
    }
    const deadlineTs = new Date(deadlineStr + "T23:59:59").getTime();
    if (!Number.isFinite(deadlineTs) || deadlineTs <= Date.now()) {
      setError("마감일은 오늘 이후여야 합니다.");
      return;
    }
    setSubmitting(true);
    try {
      const task = await auditTaskService.create({
        label: label.trim() || undefined,
        conversationIds: selectedIds,
        capacity,
        deadline: deadlineTs,
        note: note.trim() || undefined,
        createdBy: adminId,
      });
      router.push(`/admin/tasks/${task.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 px-6 py-6 max-w-4xl">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">새 Task</h1>
        <Button variant="ghost" render={<Link href="/admin/tasks" />}>
          취소
        </Button>
      </div>

      <Section title="포함할 대화" hint="후보 풀의 대화를 선택합니다. 신규/배정됨 모두 선택 가능.">
        <div className="rounded-xl border bg-card">
          {eligibleCandidates.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              후보가 없습니다. 챗에서 대화를 진행하면 자동으로 풀에 추가됩니다.
            </p>
          ) : (
            <ul className="divide-y">
              {eligibleCandidates.map((c) => {
                const occ = getOccupation(c.occupation);
                const checked = selectedIds.includes(c.id);
                const title = c.title ?? c.snapshotPayload?.topic.title ?? c.id;
                return (
                  <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(c.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{title}</span>
                        <Badge variant="outline">
                          {occ ? `${occ.emoji} ${occ.label}` : c.occupation}
                        </Badge>
                        {assignedIds.has(c.id) && (
                          <Badge variant="secondary">다른 Task 에 배정됨</Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground truncate">
                        {c.ownerLabel ?? c.ownerId} · <span title={c.id}>{middleTruncate(c.id)}</span>
                      </p>
                    </div>
                    <span className="tabular-nums text-xs text-muted-foreground">
                      {c.turnCount} turns
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <p className="text-xs text-muted-foreground">선택: {selectedIds.length}건</p>
      </Section>

      <Section title="모집 인원" hint="동시에 작업할 평가자 수.">
        <div className="flex flex-wrap items-center gap-2">
          {CAPACITY_OPTIONS.map((n) => (
            <Button
              key={n}
              variant={capacity === n ? "default" : "outline"}
              size="sm"
              onClick={() => setCapacity(n)}
            >
              {n}명
            </Button>
          ))}
          <span className="ml-2 text-xs text-muted-foreground">또는 직접 입력</span>
          <Input
            type="number"
            min={1}
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value) || 0)}
            className="h-8 w-20"
          />
        </div>
      </Section>

      <Section title="마감일">
        <Input
          type="date"
          value={deadlineStr}
          onChange={(e) => setDeadlineStr(e.target.value)}
          className="h-8 w-44"
        />
      </Section>

      <Section title="라벨 / 메모 (선택)">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="예: 병의원 — 차량/접대 묶음"
          className="h-9"
        />
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="추가 안내사항"
          rows={3}
        />
      </Section>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" render={<Link href="/admin/tasks" />}>
          취소
        </Button>
        <Button onClick={onSubmit} disabled={submitting}>
          {submitting ? "게시 중…" : "게시하기"}
        </Button>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

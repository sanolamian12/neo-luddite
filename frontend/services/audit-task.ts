"use client";

import { getSupabase } from "@/lib/supabase/client";
import { useAuditTaskStore, rowToTask, type AuditTaskRow } from "@/lib/audit-task-store";
import { useAuditWorkStore } from "@/lib/audit-work-store";
import type {
  AuditTask,
  TaskPickup,
  TaskStatus,
  Audit,
} from "@/lib/poc-schema";

/**
 * AuditTask service — admin 이 만들고 auditor 가 픽업한다.
 *
 * 쓰기: Supabase `audit_tasks`(+ 픽업 시 `audits`) 에 반영 + 낙관적 스토어 갱신.
 * 읽기: Realtime 동기화된 스토어 캐시에서 필터/정렬 (§3-3).
 */

export interface CreateTaskInput {
  label?: string;
  conversationIds: string[];
  capacity: number;
  deadline: number;
  conditions?: import("@/lib/poc-schema").TaskConditions;
  note?: string;
  createdBy: string; // adminId
}

export interface TaskFilter {
  status?: TaskStatus;
  occupation?: string;
  /** 평가자 시점 — 본인 픽업 가능 여부 필터 */
  assignableTo?: string;
}

export interface TaskListResult {
  items: AuditTask[];
  total: number;
}

export interface TaskSummary {
  open: number;
  inProgress: number;
  closed: number;
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

/** taskId 의 최신 상태를 DB 에서 직접 읽는다(픽업 경합 방지). */
async function fetchTask(taskId: string): Promise<AuditTask | null> {
  const { data, error } = await getSupabase()
    .from("audit_tasks")
    .select("*")
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToTask(data as AuditTaskRow) : null;
}

/** 새 Task 게시. */
export async function create(input: CreateTaskInput): Promise<AuditTask> {
  const sb = getSupabase();
  const task: AuditTask = {
    id: makeId("task"),
    label: input.label,
    conversationIds: input.conversationIds,
    capacity: input.capacity,
    deadline: input.deadline,
    conditions: input.conditions,
    note: input.note,
    createdAt: Date.now(),
    createdBy: input.createdBy,
    pickups: [],
    status: "open",
  };
  const { error } = await sb.from("audit_tasks").insert({
    id: task.id,
    label: task.label ?? null,
    conversation_ids: task.conversationIds,
    capacity: task.capacity,
    conditions: task.conditions ?? null,
    deadline: task.deadline,
    created_at: task.createdAt,
    created_by: task.createdBy,
    pickups: task.pickups,
    status: task.status,
    note: task.note ?? null,
  });
  if (error) throw error;
  useAuditTaskStore.getState()._upsert(task);

  // 배정됨 상태는 이제 Task 링크에서 파생한다(하차장·후보목록이 tasks 를 읽어 표시).
  // 별도 write-back(구 pool_candidates markAssigned) 불필요.

  return task;
}

/** 픽업 가능 Task 목록. */
export async function listOpenTasks(
  filter?: TaskFilter,
): Promise<TaskListResult> {
  let items = [...useAuditTaskStore.getState().tasks];

  if (filter?.status) {
    items = items.filter((t) => t.status === filter.status);
  } else {
    items = items.filter((t) => t.status === "open" || t.status === "in_progress");
  }

  if (filter?.assignableTo) {
    const auditorId = filter.assignableTo;
    items = items.filter((t) => {
      const alreadyPicked = t.pickups.some((p) => p.auditorId === auditorId);
      const full = t.pickups.length >= t.capacity;
      return !alreadyPicked && !full;
    });
  }

  items.sort((a, b) => a.deadline - b.deadline);
  return { items, total: items.length };
}

/** 모든 Task (admin 시점). */
export async function listAll(filter?: TaskFilter): Promise<TaskListResult> {
  let items = [...useAuditTaskStore.getState().tasks];
  if (filter?.status) items = items.filter((t) => t.status === filter.status);
  items.sort((a, b) => b.createdAt - a.createdAt);
  return { items, total: items.length };
}

/** 단건 조회. */
export async function getTask(id: string): Promise<AuditTask | null> {
  return useAuditTaskStore.getState().tasks.find((t) => t.id === id) ?? null;
}

export interface PickupResult {
  task: AuditTask;
  audits: Audit[]; // 1 per conversationId
}

/**
 * 평가자가 Task 픽업.
 * - 픽업 슬롯 추가 (audit_tasks.pickups jsonb)
 * - 포함된 conversation 마다 Audit (status=draft) 생성 (audits insert)
 * - Task 의 status 갱신 (full / in_progress)
 *
 * Idempotent: 동일 (taskId, auditorId) 픽업이 이미 있으면 그대로 반환.
 */
export async function pickup(
  taskId: string,
  auditorId: string,
): Promise<PickupResult> {
  const sb = getSupabase();
  const task = await fetchTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  // 이미 픽업했는지 검사
  const existing = task.pickups.find((p) => p.auditorId === auditorId);
  if (existing) {
    const audits = useAuditWorkStore
      .getState()
      .audits.filter((a) => a.taskId === taskId && a.auditorId === auditorId);
    return { task, audits };
  }

  if (task.pickups.length >= task.capacity) {
    throw new Error("Task capacity exceeded");
  }

  // Audit 생성 (conversation 당 1건)
  const now = Date.now();
  const audits: Audit[] = task.conversationIds.map((convId) => ({
    id: makeId("audit"),
    taskId: task.id,
    conversationId: convId,
    auditorId,
    pickedAt: now,
    status: "draft" as const,
    progress: {
      feedbackCount: 0,
      hasSessionEval: false,
      totalSegments: 0,
    },
  }));
  const { error: auditErr } = await sb.from("audits").insert(
    audits.map((a) => ({
      id: a.id,
      task_id: a.taskId,
      conversation_id: a.conversationId,
      auditor_id: a.auditorId,
      picked_at: a.pickedAt,
      submitted_at: null,
      status: a.status,
      progress: a.progress,
    })),
  );
  if (auditErr) throw auditErr;
  for (const a of audits) useAuditWorkStore.getState()._upsert(a);

  // Task 픽업 슬롯 추가 — pickup 슬롯은 (auditor, 첫 audit) 의 페어로 기록
  const firstAudit = audits[0];
  const newPickup: TaskPickup = {
    auditorId,
    pickedAt: now,
    auditId: firstAudit.id,
  };
  const newPickups = [...task.pickups, newPickup];
  const newStatus: TaskStatus =
    newPickups.length >= task.capacity ? "full" : "in_progress";
  const { error: taskErr } = await sb
    .from("audit_tasks")
    .update({ pickups: newPickups, status: newStatus })
    .eq("id", task.id);
  if (taskErr) throw taskErr;

  const updated: AuditTask = { ...task, pickups: newPickups, status: newStatus };
  useAuditTaskStore.getState()._patch(task.id, {
    pickups: newPickups,
    status: newStatus,
  });
  return { task: updated, audits };
}

/** 픽업 해제 (작업 전이고 기여 0 인 경우만). */
export async function releasePickup(
  taskId: string,
  auditorId: string,
): Promise<AuditTask> {
  const sb = getSupabase();
  const task = await fetchTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  // 해당 auditor 의 audit 들 — feedback 이 하나라도 있으면 거부
  const myAudits = useAuditWorkStore
    .getState()
    .audits.filter((a) => a.taskId === taskId && a.auditorId === auditorId);
  for (const a of myAudits) {
    if (a.progress.feedbackCount > 0 || a.progress.hasSessionEval) {
      throw new Error("기여 데이터가 있어 작업을 취소할 수 없습니다.");
    }
  }
  if (myAudits.length > 0) {
    const ids = myAudits.map((a) => a.id);
    const { error } = await sb.from("audits").delete().in("id", ids);
    if (error) throw error;
    for (const id of ids) useAuditWorkStore.getState()._remove(id);
  }

  const newPickups = task.pickups.filter((p) => p.auditorId !== auditorId);
  const newStatus: TaskStatus =
    newPickups.length === 0
      ? "open"
      : newPickups.length >= task.capacity
        ? "full"
        : "in_progress";
  const { error: taskErr } = await sb
    .from("audit_tasks")
    .update({ pickups: newPickups, status: newStatus })
    .eq("id", task.id);
  if (taskErr) throw taskErr;

  useAuditTaskStore.getState()._patch(task.id, {
    pickups: newPickups,
    status: newStatus,
  });
  return { ...task, pickups: newPickups, status: newStatus };
}

/**
 * 개별 audit 취소 (미착수·기여 0 인 경우만). 같은 task 의 다른 audit 은 유지.
 *
 * releasePickup 은 (task, auditor) 의 모든 audit 을 한꺼번에 지우지만, 벌크로
 * conversationId 여러 개가 한 task 에 묶인 경우 사용자는 목록의 한 행(=대화 1건)만
 * 취소하길 기대한다. 이 함수는 그 한 건만 지우고:
 *  · 같은 task 에 내 audit 이 남아 있으면 → 픽업 슬롯 유지(슬롯이 지워진 audit 을
 *    가리키면 남은 것으로 재지정).
 *  · 남은 audit 이 없으면 → 픽업 슬롯 해제 + task 상태 재계산(releasePickup 과 동일).
 */
export async function cancelAudit(
  auditId: string,
  auditorId: string,
): Promise<void> {
  const sb = getSupabase();
  const audit = useAuditWorkStore
    .getState()
    .audits.find((a) => a.id === auditId);
  if (!audit) throw new Error(`Audit not found: ${auditId}`);
  if (audit.auditorId !== auditorId) {
    throw new Error("본인 작업만 취소할 수 있습니다.");
  }
  if (audit.status !== "draft") {
    throw new Error("이미 제출된 작업은 취소할 수 없습니다.");
  }
  if (audit.progress.feedbackCount > 0 || audit.progress.hasSessionEval) {
    throw new Error("기여 데이터가 있어 작업을 취소할 수 없습니다.");
  }

  // 1) 해당 audit 만 삭제
  const { error: delErr } = await sb.from("audits").delete().eq("id", auditId);
  if (delErr) throw delErr;
  useAuditWorkStore.getState()._remove(auditId);

  // 2) 같은 task 에서 내가 가진 audit 이 더 남았는지 (store 는 _remove 로 이미 갱신됨)
  const remaining = useAuditWorkStore
    .getState()
    .audits.filter((a) => a.taskId === audit.taskId && a.auditorId === auditorId);

  const task = await fetchTask(audit.taskId);
  if (!task) return; // task 가 이미 없으면 audit 삭제로 충분

  if (remaining.length > 0) {
    // 픽업 슬롯 유지. 슬롯이 방금 지운 audit 을 가리키면 남은 것으로 재지정.
    const needsRepoint = task.pickups.some(
      (p) => p.auditorId === auditorId && p.auditId === auditId,
    );
    if (!needsRepoint) return;
    const newPickups = task.pickups.map((p) =>
      p.auditorId === auditorId && p.auditId === auditId
        ? { ...p, auditId: remaining[0].id }
        : p,
    );
    const { error } = await sb
      .from("audit_tasks")
      .update({ pickups: newPickups })
      .eq("id", task.id);
    if (error) throw error;
    useAuditTaskStore.getState()._patch(task.id, { pickups: newPickups });
    return;
  }

  // 3) 남은 audit 이 없으면 픽업 해제 + task 상태 재계산
  const newPickups = task.pickups.filter((p) => p.auditorId !== auditorId);
  const newStatus: TaskStatus =
    newPickups.length === 0
      ? "open"
      : newPickups.length >= task.capacity
        ? "full"
        : "in_progress";
  const { error: taskErr } = await sb
    .from("audit_tasks")
    .update({ pickups: newPickups, status: newStatus })
    .eq("id", task.id);
  if (taskErr) throw taskErr;
  useAuditTaskStore.getState()._patch(task.id, {
    pickups: newPickups,
    status: newStatus,
  });
}

/** Task 마감 처리 (admin). */
export async function forceClose(taskId: string): Promise<AuditTask> {
  const sb = getSupabase();
  const { error } = await sb
    .from("audit_tasks")
    .update({ status: "closed" })
    .eq("id", taskId);
  if (error) throw error;
  useAuditTaskStore.getState()._patch(taskId, { status: "closed" });
  return (await getTask(taskId)) ?? (await fetchTask(taskId))!;
}

/** Task 마감일 연장 (admin). */
export async function extendDeadline(
  taskId: string,
  newDeadline: number,
): Promise<AuditTask> {
  const sb = getSupabase();
  const { error } = await sb
    .from("audit_tasks")
    .update({ deadline: newDeadline })
    .eq("id", taskId);
  if (error) throw error;
  useAuditTaskStore.getState()._patch(taskId, { deadline: newDeadline });
  return (await getTask(taskId)) ?? (await fetchTask(taskId))!;
}

export async function summary(): Promise<TaskSummary> {
  let open = 0;
  let inProgress = 0;
  let closed = 0;
  for (const t of useAuditTaskStore.getState().tasks) {
    if (t.status === "open") open += 1;
    else if (t.status === "in_progress" || t.status === "full") inProgress += 1;
    else if (t.status === "closed") closed += 1;
  }
  return { open, inProgress, closed };
}

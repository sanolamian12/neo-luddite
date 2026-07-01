"use client";

import { useAuditTaskStore } from "@/lib/audit-task-store";
import { useAuditWorkStore } from "@/lib/audit-work-store";
import * as poolService from "./pool";
import type {
  AuditTask,
  TaskConditions,
  TaskPickup,
  TaskStatus,
  Audit,
} from "@/lib/poc-schema";

/**
 * AuditTask service — admin 이 만들고 auditor 가 픽업한다.
 */

export interface CreateTaskInput {
  label?: string;
  conversationIds: string[];
  capacity: number;
  deadline: number;
  conditions?: TaskConditions;
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

/** 새 Task 게시. */
export async function create(input: CreateTaskInput): Promise<AuditTask> {
  const store = useAuditTaskStore.getState();
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
  store._upsert(task);

  // pool 의 conversation 들을 assigned 로 마킹
  await poolService.markAssigned(input.conversationIds);

  return task;
}

/** 픽업 가능 Task 목록. */
export async function listOpenTasks(
  filter?: TaskFilter,
): Promise<TaskListResult> {
  const store = useAuditTaskStore.getState();
  let items = [...store.tasks];

  // 상태 기본은 open + in_progress (둘 다 추가 픽업 가능할 수 있음 — open 만 가능하지만 in_progress 도 다른 슬롯 남았을 수 있음)
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
  const store = useAuditTaskStore.getState();
  let items = [...store.tasks];
  if (filter?.status) items = items.filter((t) => t.status === filter.status);
  items.sort((a, b) => b.createdAt - a.createdAt);
  return { items, total: items.length };
}

/** 단건 조회. */
export async function getTask(id: string): Promise<AuditTask | null> {
  const store = useAuditTaskStore.getState();
  return store.tasks.find((t) => t.id === id) ?? null;
}

export interface PickupResult {
  task: AuditTask;
  audits: Audit[]; // 1 per conversationId
}

/**
 * 평가자가 Task 픽업.
 * - 픽업 슬롯 추가
 * - 포함된 conversation 마다 Audit (status=draft) 생성
 * - Task 의 status 갱신 (full / in_progress)
 *
 * Idempotent: 동일 (taskId, auditorId) 픽업이 이미 있으면 그대로 반환.
 */
export async function pickup(
  taskId: string,
  auditorId: string,
): Promise<PickupResult> {
  const taskStore = useAuditTaskStore.getState();
  const workStore = useAuditWorkStore.getState();
  const task = taskStore.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  // 이미 픽업했는지 검사
  const existing = task.pickups.find((p) => p.auditorId === auditorId);
  if (existing) {
    const audits = workStore.audits.filter(
      (a) => a.taskId === taskId && a.auditorId === auditorId,
    );
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
  for (const a of audits) workStore._upsert(a);

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
  taskStore._patch(task.id, {
    pickups: newPickups,
    status: newStatus,
  });

  const updated = useAuditTaskStore
    .getState()
    .tasks.find((t) => t.id === taskId)!;
  return { task: updated, audits };
}

/** 픽업 해제 (작업 전이고 기여 0 인 경우만). */
export async function releasePickup(
  taskId: string,
  auditorId: string,
): Promise<AuditTask> {
  const taskStore = useAuditTaskStore.getState();
  const workStore = useAuditWorkStore.getState();
  const task = taskStore.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  // 해당 auditor 의 audit 들 — feedback 이 하나라도 있으면 거부
  const myAudits = workStore.audits.filter(
    (a) => a.taskId === taskId && a.auditorId === auditorId,
  );
  for (const a of myAudits) {
    if (a.progress.feedbackCount > 0 || a.progress.hasSessionEval) {
      throw new Error("기여 데이터가 있어 작업을 취소할 수 없습니다.");
    }
    workStore._remove(a.id);
  }

  const newPickups = task.pickups.filter((p) => p.auditorId !== auditorId);
  const newStatus: TaskStatus =
    newPickups.length === 0
      ? "open"
      : newPickups.length >= task.capacity
        ? "full"
        : "in_progress";
  taskStore._patch(task.id, {
    pickups: newPickups,
    status: newStatus,
  });
  return useAuditTaskStore.getState().tasks.find((t) => t.id === taskId)!;
}

/** Task 마감 처리 (admin). */
export async function forceClose(taskId: string): Promise<AuditTask> {
  useAuditTaskStore.getState()._patch(taskId, { status: "closed" });
  return (await getTask(taskId))!;
}

/** Task 마감일 연장 (admin). */
export async function extendDeadline(
  taskId: string,
  newDeadline: number,
): Promise<AuditTask> {
  useAuditTaskStore.getState()._patch(taskId, { deadline: newDeadline });
  return (await getTask(taskId))!;
}

export async function summary(): Promise<TaskSummary> {
  const store = useAuditTaskStore.getState();
  let open = 0;
  let inProgress = 0;
  let closed = 0;
  for (const t of store.tasks) {
    if (t.status === "open") open += 1;
    else if (t.status === "in_progress" || t.status === "full") inProgress += 1;
    else if (t.status === "closed") closed += 1;
  }
  return { open, inProgress, closed };
}

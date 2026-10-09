import { demoRunSchema, type DemoRun } from "./domain";
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
export const runKey = (id: string) => `neo-demo-run-v1:${id}`;
export function loadRun(storage: Storage, id: string): DemoRun | null {
  const raw = storage.getItem(runKey(id));
  if (!raw) return null;
  const run = demoRunSchema.parse(JSON.parse(raw));
  if (run.id !== id) throw new Error("데모 ID가 일치하지 않습니다.");
  return run;
}
export function saveRun(storage: Storage, input: DemoRun, expectedRevision: number | null): DemoRun {
  const current = loadRun(storage, input.id);
  if ((current?.revision ?? null) !== expectedRevision) throw new Error("다른 화면에서 변경되었습니다. 최신 상태를 불러와 주세요.");
  const next = demoRunSchema.parse({ ...input, revision: (current?.revision ?? 0) + 1, updatedAt: new Date().toISOString() });
  storage.setItem(runKey(input.id), JSON.stringify(next));
  return next;
}

import { Suspense } from "react";
import { TaskCreateForm } from "@/components/admin/task-create-form";

export default function AdminTaskNewPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <Suspense fallback={<div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>}>
        <TaskCreateForm />
      </Suspense>
    </div>
  );
}

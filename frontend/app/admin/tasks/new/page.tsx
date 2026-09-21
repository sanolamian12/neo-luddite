import { Suspense } from "react";
import { TaskCreateForm } from "@/components/admin/task-create-form";
import { LoadingBlock } from "@/components/ui/spinner";

export default function AdminTaskNewPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <Suspense fallback={<LoadingBlock label="로딩 중…" />}>
        <TaskCreateForm />
      </Suspense>
    </div>
  );
}

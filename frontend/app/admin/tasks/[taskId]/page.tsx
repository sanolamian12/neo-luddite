import { TaskDetailView } from "@/components/admin/task-detail-view";

export default async function AdminTaskDetailPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  return (
    <div className="flex-1 overflow-y-auto">
      <TaskDetailView taskId={decodeURIComponent(taskId)} />
    </div>
  );
}

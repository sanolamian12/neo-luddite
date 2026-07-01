import { TasksTable } from "@/components/admin/tasks-table";

export default function AdminTasksPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <TasksTable />
    </div>
  );
}

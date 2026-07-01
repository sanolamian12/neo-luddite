import { QueueTable } from "@/components/auditor/queue-table";

export default function AuditQueuePage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <QueueTable />
    </div>
  );
}

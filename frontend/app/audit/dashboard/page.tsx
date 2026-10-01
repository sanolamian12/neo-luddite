import { DashboardView } from "@/components/auditor/dashboard-view";

import { ExpertDashboard } from "@/components/audit/agents/expert-dashboard";
import { isPrototype } from "@/lib/data-mode";

export default function AuditDashboardPage() {
  if (isPrototype) return <ExpertDashboard />;
  return (
    <div className="flex-1 overflow-y-auto">
      <DashboardView />
    </div>
  );
}

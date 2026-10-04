import { DashboardView } from "@/components/auditor/dashboard-view";

import { ExpertDashboard } from "@/components/audit/agents/expert-dashboard";
import { agentStudioEnabled } from "@/lib/data-mode";

export default function AuditDashboardPage() {
  if (agentStudioEnabled) return <ExpertDashboard />;
  return (
    <div className="flex-1 overflow-y-auto">
      <DashboardView />
    </div>
  );
}

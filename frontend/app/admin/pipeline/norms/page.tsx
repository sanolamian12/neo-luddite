import { NormsView } from "@/components/audit/kb/norms-view";

export default function AdminNormsPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <NormsView mode="admin" />
    </div>
  );
}

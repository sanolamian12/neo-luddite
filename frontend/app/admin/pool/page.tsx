import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PoolTable } from "@/components/admin/pool-table";

export default function AdminPoolPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex justify-end px-6 pt-6">
        <Button size="sm" render={<Link href="/admin/pool/upload" />}>
          엑셀 화물 업로드
        </Button>
      </div>
      <PoolTable />
    </div>
  );
}

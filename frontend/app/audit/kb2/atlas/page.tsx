import { Suspense } from "react";
import { Kb2Atlas } from "@/components/audit/kb/kb2-atlas";

export default function Kb2AtlasPage() {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-8">
          지식 지도를 불러오는 중…
        </p>
      }
    >
      <Kb2Atlas />
    </Suspense>
  );
}

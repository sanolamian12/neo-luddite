"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { getScenario, resetPrototypeData, type Scenario } from "@/lib/prototype/backend";

const subscribe = () => () => {};
const serverScenario = (): Scenario => "populated";

/** Kept on the login screen so prototype tools do not cover product controls. */
export function PrototypeControls() {
  const scenario = useSyncExternalStore(subscribe, getScenario, serverScenario);
  const [error, setError] = useState("");

  function changeScenario(next: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("prototypeScenario", next);
    window.location.assign(url);
  }

  return (
    <details className="rounded-lg border bg-background p-3 text-sm">
      <summary className="cursor-pointer rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
        프로토타입 · 샘플 데이터
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <p>아래 데모 계정으로 둘러보세요. 변경한 데이터는 이 브라우저에만 저장됩니다.</p>
        <label className="flex flex-col gap-1.5">
          <span>화면 상태</span>
          <select
            value={scenario}
            onChange={(event) => changeScenario(event.target.value)}
            className="min-h-11 rounded-md border bg-background px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <option value="populated">샘플 데이터</option>
            <option value="empty">빈 데이터</option>
            <option value="slow">느린 응답 (1.5초)</option>
            <option value="error">오류 응답</option>
          </select>
        </label>
        <Button variant="outline" className="min-h-11" onClick={() => {
          try {
            resetPrototypeData(window.localStorage);
            window.location.reload();
          } catch {
            setError("브라우저 저장소에 접근할 수 없습니다. 사이트의 저장소 설정을 확인해 주세요.");
          }
        }}>샘플 데이터 초기화</Button>
        <p className="text-muted-foreground">초기화하면 프로토타입의 데이터 변경 내용이 지워집니다.</p>
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </div>
    </details>
  );
}

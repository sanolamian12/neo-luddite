"use client";

import { useCallback, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * 롱프레스 훅 — 이 레포에 전례가 없어 새로 작성(2026-09-09, KB2 문장 이동 UI).
 * Pointer Events 기반(마우스·터치 겸용). 임계값(기본 500ms) 넘게 누르고 있으면 콜백.
 *
 * setPointerCapture로 포인터를 캡처한다 — 손잡이 아이콘처럼 히트 영역이 작을 때, 누른
 * 채로 살짝만 움직여도(실제 드래그하듯 움직이면) 포인터가 요소 밖으로 나가 onPointerLeave
 * 로 취소되던 문제(2026-09-09 실사용 중 발견 — "눌러도 반응이 없다")를 막는다. 캡처
 * 상태에서는 커서가 요소 밖으로 나가도 이벤트가 계속 이 요소로 온다.
 */
export function useLongPress(onLongPress: () => void, thresholdMs = 500) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback((e?: ReactPointerEvent) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (e) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // 이미 해제됐거나 캡처가 성립하지 않은 경우 — 무시.
      }
    }
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // setPointerCapture 미지원 환경 — 캡처 없이도 제자리에서 누르면 정상 동작.
      }
      timerRef.current = setTimeout(onLongPress, thresholdMs);
    },
    [onLongPress, thresholdMs],
  );

  return {
    onPointerDown,
    onPointerUp: clear,
    onPointerCancel: clear,
  };
}

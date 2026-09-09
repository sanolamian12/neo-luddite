"use client";

import { useCallback, useRef } from "react";

/**
 * 롱프레스 훅 — 이 레포에 전례가 없어 새로 작성(2026-09-09, KB2 문장 이동 UI).
 * Pointer Events 기반(마우스·터치 겸용). 임계값(기본 500ms) 넘게 누르고 있으면 콜백,
 * 그전에 떼거나 포인터가 벗어나면 취소.
 */
export function useLongPress(onLongPress: () => void, thresholdMs = 500) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);

  const start = useCallback(() => {
    firedRef.current = false;
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      onLongPress();
    }, thresholdMs);
  }, [onLongPress, thresholdMs]);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return {
    onPointerDown: start,
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    /** 롱프레스가 실제로 발동됐는지 — 클릭 핸들러에서 "롱프레스 뒤 클릭" 오발동을 막을 때 사용. */
    didFire: () => firedRef.current,
  };
}

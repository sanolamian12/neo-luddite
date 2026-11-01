"use client";

import { useEffect, useState, type RefObject } from "react";

export function useRotatingPlaceholder(
  inputRef: RefObject<HTMLTextAreaElement | null>,
  examples: readonly string[] | undefined,
  active: boolean,
) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const input = inputRef.current;
    if (!active || !input || !examples || examples.length < 2) return;

    const exampleCount = examples.length;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    let interval: ReturnType<typeof setInterval> | undefined;

    function updateTimer() {
      clearInterval(interval);
      interval = undefined;
      if (visible && document.visibilityState === "visible" && !motion.matches) {
        interval = setInterval(() => setIndex((current) => (current + 1) % exampleCount), 4000);
      }
    }

    function updateMotion() {
      if (motion.matches) setIndex(0);
      updateTimer();
    }

    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      updateTimer();
    });

    observer?.observe(input);
    document.addEventListener("visibilitychange", updateTimer);
    motion.addEventListener("change", updateMotion);

    return () => {
      clearInterval(interval);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", updateTimer);
      motion.removeEventListener("change", updateMotion);
    };
  }, [active, examples, inputRef]);

  return examples?.[index % examples.length];
}

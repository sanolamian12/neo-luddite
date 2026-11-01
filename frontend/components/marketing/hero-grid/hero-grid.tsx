"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { createGridRenderer, type GridRenderer } from "./renderer";
import styles from "./hero-grid.module.css";

export function HeroGrid() {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<GridRenderer | null>(null);
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const field = root.current;
    const surface = canvas.current;
    if (!field || !surface) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const forced = matchMedia("(forced-colors: active)");
    let disposed = false;
    function release() {
      renderer.current?.destroy();
      renderer.current = null;
      delete field!.dataset.renderer;
    }
    function install() {
      release();
      if (disposed || reduced.matches || forced.matches) return;
      try {
        renderer.current = createGridRenderer(surface!);
        if (renderer.current) {
          renderer.current.setPaused(pausedRef.current);
          field!.dataset.renderer = "webgl";
        }
      } catch {
        // Decoration is optional: retain the static grid if GPU setup is unavailable.
        release();
      }
    }
    function lost(event: Event) { event.preventDefault(); release(); }
    surface.addEventListener("webglcontextlost", lost);
    surface.addEventListener("webglcontextrestored", install);
    reduced.addEventListener("change", install);
    forced.addEventListener("change", install);
    install();
    return () => {
      disposed = true;
      surface.removeEventListener("webglcontextlost", lost);
      surface.removeEventListener("webglcontextrestored", install);
      reduced.removeEventListener("change", install);
      forced.removeEventListener("change", install);
      release();
    };
  }, []);

  function toggle() {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
    renderer.current?.setPaused(pausedRef.current);
  }

  return <div ref={root} className={styles.background} data-hero-grid>
    <div className={styles.field} aria-hidden="true">
      <div className={styles.staticGrid} />
      <canvas ref={canvas} className={styles.canvas} />
    </div>
    <button type="button" className={styles.toggle} onClick={toggle}
      aria-label={paused ? "배경 움직임 재생" : "배경 움직임 멈추기"}
      title={paused ? "배경 움직임 재생" : "배경 움직임 멈추기"}>
      {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
    </button>
  </div>;
}

import styles from "./imprint.module.css";

/** Decorative brand geometry. Labels and recorded product state own meaning. */
export function ImprintMark({ className = "", size = 32 }: { className?: string; size?: number }) {
  return <svg className={`${styles.mark} ${className}`} width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
    {[0, 1, 2, 3].map((i) => <path key={i}
      d={`M${27 - i * 2.6} ${8 + i * 1.8} V${21 - i * .7} Q${27 - i * 2.5} ${28 - i * 2.5} ${20 - i * .6} ${28 - i * 2.5} H${10 + i * .8} Q${4 + i * 2.5} ${28 - i * 2.5} ${4 + i * 2.5} ${20 - i * .4} V${10 + i * .8} Q${4 + i * 2.5} ${4 + i * 2.5} ${11 + i * .5} ${4 + i * 2.5} H${21 - i * .7}`}
      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity={.35 + i * .2} />)}
  </svg>;
}

const contours = Array.from({ length: 18 }, (_, i) => ({
  d: `M570 ${28 + i * 5} C420 ${28 + i * 5} 416 ${204 - i * 4.6} 252 ${204 - i * 4.6} H150 C${76 + i * 4.3} ${204 - i * 4.6} ${28 + i * 4.8} ${158 - i * 2.2} ${28 + i * 4.8} 108 C${28 + i * 4.8} ${50 + i * 2.2} ${78 + i * 4.3} ${12 + i * 4.6} 150 ${12 + i * 4.6} H280`,
  opacity: i === 17 ? 1 : .2 + i * .024,
}));

/** A single contour field for public/creative surfaces; never a task-state badge. */
export function ImprintContours({ className = "", reveal = false }: { className?: string; reveal?: boolean }) {
  return <svg className={`${styles.contours} ${className}`} data-reveal={reveal || undefined} viewBox="0 0 600 230" fill="none" aria-hidden="true" focusable="false">
    {contours.map(({ d, opacity }, i) => <path key={i} d={d} pathLength="1" opacity={opacity} stroke="currentColor" strokeWidth={i === 17 ? 2.4 : 1.1} strokeLinecap="round" />)}
  </svg>;
}

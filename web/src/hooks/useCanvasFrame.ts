// Canvas drawing on every animation frame, from one shared requestAnimationFrame loop for the whole page.
// Charts read their data from the trace buffers and the store when they draw, so a server message never
// has to re-render a chart component.
import {useEffect, useRef, type RefObject} from 'react';

export type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number, now: number) => void;

const drawers = new Set<(now: number) => void>();
let frame = 0;
function tick(now: number) {
  for (const draw of drawers) draw(now);
  frame = drawers.size ? requestAnimationFrame(tick) : 0;
}
function subscribe(draw: (now: number) => void): () => void {
  drawers.add(draw);
  if (!frame) frame = requestAnimationFrame(tick);
  return () => {
    drawers.delete(draw);
  };
}

/**
 * Sizes the canvas to its CSS box at the device pixel ratio and clears it. Returns null while the canvas has no
 * size (hidden, or not laid out yet), so there is nothing to draw.
 */
export function prepareCanvas(cv: HTMLCanvasElement): {ctx: CanvasRenderingContext2D; w: number; h: number} | null {
  const w = cv.clientWidth,
    h = cv.clientHeight;
  if (!w || !h) return null;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return {ctx, w, h};
}

/** Calls `draw` for this canvas on every animation frame while the component is mounted. */
export function useCanvasFrame(draw: Draw): RefObject<HTMLCanvasElement | null> {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const latest = useRef(draw);
  latest.current = draw;
  useEffect(
    () =>
      subscribe(now => {
        const cv = ref.current;
        const c = cv && prepareCanvas(cv);
        if (c) latest.current(c.ctx, c.w, c.h, now);
      }),
    []
  );
  return ref;
}

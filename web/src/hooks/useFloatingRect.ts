// Position and size of the floating rival popup: dragged by its header, resized from the right edge, bottom
// edge or corner, kept on screen, and remembered in localStorage.
import {useCallback, useEffect, useRef, useState} from 'react';
import {KEYS, readJson, write} from '../storage';
import {trackPointer} from './dom';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
const MIN_W = 380,
  MIN_H = 300,
  MARGIN = 6;

/** 56% x 72% of the window (at most 980 x 700), centred. */
export function defaultRect(): Rect {
  const w = Math.min(Math.round(innerWidth * 0.56), 980),
    h = Math.min(Math.round(innerHeight * 0.72), 700);
  return {w, h, x: Math.round((innerWidth - w) / 2), y: Math.round((innerHeight - h) / 2)};
}

/** The rect kept above the minimum size and inside the window. */
export function clampRect(r: Rect): Rect {
  const w = Math.max(MIN_W, Math.min(r.w, innerWidth - MARGIN * 2));
  const h = Math.max(MIN_H, Math.min(r.h, innerHeight - MARGIN * 2));
  return {
    w,
    h,
    x: Math.max(MARGIN, Math.min(r.x, innerWidth - w - MARGIN)),
    y: Math.max(MARGIN, Math.min(r.y, innerHeight - h - MARGIN)),
  };
}

function savedRect(): Rect {
  const r = readJson<Rect>(KEYS.popup);
  const ok = r && [r.x, r.y, r.w, r.h].every(v => typeof v === 'number' && isFinite(v));
  return clampRect(ok ? r : defaultRect());
}

export type Edge = 'r' | 'b' | 'br';

export function useFloatingRect() {
  const [rect, setRectState] = useState(savedRect);
  const current = useRef(rect);
  const setRect = (r: Rect) => {
    current.current = r;
    setRectState(r);
  };

  useEffect(() => {
    const onResize = () => setRect(clampRect(current.current));
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  }, []);

  /** Follows a drag from the header (move) or an edge (resize), and remembers the result. */
  const drag = useCallback((e: React.PointerEvent, edge: Edge | null) => {
    e.preventDefault();
    const start = current.current,
      sx = e.clientX,
      sy = e.clientY;
    trackPointer(e, {
      bodyClass: 'popup-drag',
      onMove: ev => {
        const dx = ev.clientX - sx,
          dy = ev.clientY - sy;
        setRect(
          clampRect(
            edge
              ? {...start, w: edge.includes('r') ? start.w + dx : start.w, h: edge.includes('b') ? start.h + dy : start.h}
              : {...start, x: start.x + dx, y: start.y + dy}
          )
        );
      },
      onEnd: () => write(KEYS.popup, current.current),
    });
  }, []);

  /** Back to the default size and place. */
  const reset = useCallback(() => {
    const r = clampRect(defaultRect());
    setRect(r);
    write(KEYS.popup, r);
  }, []);

  return {rect, drag, reset};
}

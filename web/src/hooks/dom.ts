// Small DOM hooks: Escape to close, a media query, a class on <body>, and pointer drags.
import {useEffect, useSyncExternalStore} from 'react';

/** Calls onEscape when Escape is pressed anywhere, while `active`. */
export function useEscape(onEscape: () => void, active = true): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onEscape, active]);
}

/** Whether a media query matches, kept up to date. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    notify => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', notify);
      return () => mq.removeEventListener('change', notify);
    },
    () => window.matchMedia(query).matches
  );
}
/** The desktop layout: resizable columns side by side (narrower screens stack the sections). */
export const DESKTOP = '(min-width: 1000px)';
export const useDesktop = () => useMediaQuery(DESKTOP);

/** Puts a class on <body> while `on`. */
export function useBodyClass(cls: string, on: boolean): void {
  useEffect(() => {
    if (!on) return;
    document.body.classList.add(cls);
    return () => document.body.classList.remove(cls);
  }, [cls, on]);
}

/**
 * Follows a pointer from a pointerdown until it is released: onMove for every move, onEnd once at the end
 * (cancelled=true when the browser took the pointer away). The pressed element captures the pointer, so the drag
 * keeps working outside it; bodyClass is set on <body> meanwhile (for the cursor).
 */
export function trackPointer(
  e: React.PointerEvent<Element>,
  {onMove, onEnd, bodyClass}: {onMove: (ev: PointerEvent) => void; onEnd?: (cancelled: boolean) => void; bodyClass?: string}
): void {
  const target = e.currentTarget;
  target.setPointerCapture?.(e.pointerId);
  if (bodyClass) document.body.classList.add(bodyClass);
  const move = (ev: Event) => onMove(ev as PointerEvent);
  const done = (ev: Event) => {
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', done);
    target.removeEventListener('pointercancel', done);
    if (bodyClass) document.body.classList.remove(bodyClass);
    onEnd?.(ev.type === 'pointercancel');
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', done);
  target.addEventListener('pointercancel', done);
}

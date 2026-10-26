// A divider between two columns (dir 'x') or two sections in a column (dir 'y'): drag it, or focus it and use
// the arrow keys along its axis. Every pane beside it is frozen at its current size first, so the px weights
// stay comparable to each other.
import {useState} from 'react';
import {trackPointer, useDesktop} from '../../hooks/dom';
import {setSizes, type Sizes} from '../../store/layout';

const MIN = {x: 220, y: 110};
const STEP = 24;

interface Measured {
  a: string;
  b: string;
  sa: number;
  total: number;
  min: number;
}

/** The current size of every pane in the divider's group (columns, or the sections of one column). */
function freeze(split: HTMLElement, horizontal: boolean): Sizes {
  const group = [...split.parentElement!.children].filter(el => el.id && !el.classList.contains('split'));
  // read every size before writing any, or each write reflows the layout under the next read
  return Object.fromEntries(group.map(el => {
    const r = el.getBoundingClientRect();
    return [el.id, horizontal ? r.width : r.height];
  }));
}

function measure(split: HTMLElement, frozen: Sizes, horizontal: boolean): Measured {
  const a = split.previousElementSibling!.id,
    b = split.nextElementSibling!.id;
  return {a, b, sa: frozen[a], total: frozen[a] + frozen[b], min: MIN[horizontal ? 'x' : 'y']};
}

function resized(m: Measured, size: number): Sizes {
  const na = Math.min(m.total - m.min, Math.max(m.min, size));
  return {[m.a]: na, [m.b]: m.total - na};
}

const KEY_STEP: Record<string, number> = {ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1};

export function Splitter({dir}: {dir: 'x' | 'y'}) {
  const desktop = useDesktop();
  const [dragging, setDragging] = useState(false);
  const horizontal = dir === 'x';

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!desktop) return;
    e.preventDefault();
    const split = e.currentTarget;
    const frozen = freeze(split, horizontal);
    const m = measure(split, frozen, horizontal);
    const start = horizontal ? e.clientX : e.clientY;
    setSizes(frozen);
    setDragging(true);
    let latest = frozen;
    trackPointer(e, {
      bodyClass: horizontal ? 'resizing-x' : 'resizing-y',
      onMove: ev => {
        latest = {...frozen, ...resized(m, m.sa + (horizontal ? ev.clientX : ev.clientY) - start)};
        setSizes(latest);
      },
      onEnd: () => {
        setDragging(false);
        setSizes(latest, true);
      },
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = KEY_STEP[e.key];
    const alongAxis = horizontal ? e.key === 'ArrowLeft' || e.key === 'ArrowRight' : e.key === 'ArrowUp' || e.key === 'ArrowDown';
    if (!step || !alongAxis) return;
    e.preventDefault();
    const frozen = freeze(e.currentTarget, horizontal);
    const m = measure(e.currentTarget, frozen, horizontal);
    setSizes({...frozen, ...resized(m, m.sa + step * STEP)}, true);
  };

  return (
    <div
      className={`split${dragging ? ' drag' : ''}`}
      data-dir={dir}
      role="separator"
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      aria-label={horizontal ? 'Resize columns' : 'Resize sections'}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}

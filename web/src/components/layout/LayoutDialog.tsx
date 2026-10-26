// Layout dialog: drag sections between columns (or move a focused one with the arrow keys), add or remove
// columns, then Save. Nothing on the dashboard changes until Save.
import {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {MAX_COLS, moveSection, normalizeArrangement, sameArrangement} from '@shared';
import type {Arrangement} from '@shared';
import {trackPointer, useBodyClass, useEscape} from '../../hooks/dom';
import {DEFAULT_ARRANGEMENT, SECTION_IDS, saveArrangement, useLayout} from '../../store/layout';
import {setLayoutOpen, useUi} from '../../store/ui';
import {SECTIONS} from './Dashboard';

const DRAG_PX = 4; // pointer travel before a press on a section becomes a drag
const copy = (a: Arrangement): Arrangement => ({cols: a.cols.map(c => [...c])});

interface Drop {
  col: number;
  /** Position in the column, counted without the dragged section. */
  index: number;
}
interface Drag {
  id: string;
  x: number;
  y: number;
  target: Drop;
}

/**
 * Where a section dropped at (x, y) lands: the column under the pointer (or the nearest), before the first section
 * whose middle is below the pointer.
 */
function dropTarget(grid: HTMLElement, x: number, y: number, id: string): Drop {
  const cols = [...grid.querySelectorAll<HTMLElement>('.locol')];
  let col = 0,
    best = Infinity;
  cols.forEach((c, i) => {
    const r = c.getBoundingClientRect();
    const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    if (d < best) {
      best = d;
      col = i;
    }
  });
  const tiles = [...cols[col].querySelectorAll<HTMLElement>('.lotile')].filter(t => t.dataset.id !== id);
  const index = tiles.findIndex(t => {
    const r = t.getBoundingClientRect();
    return y < r.top + r.height / 2;
  });
  return {col, index: index < 0 ? tiles.length : index};
}

function LayoutEditor() {
  const saved = useLayout(s => s.arrangement);
  const [draft, setDraft] = useState(() => copy(saved));
  const [resetSizes, setResetSizes] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [focusId, setFocusId] = useState<string | null>(saved.cols[0]?.[0] ?? null);
  const grid = useRef<HTMLDivElement>(null);
  const close = () => setLayoutOpen(false);
  useEscape(close);
  useBodyClass('lodragging', !!drag);

  // focus follows the section that was moved (and starts on the first one)
  useEffect(() => {
    if (focusId) grid.current?.querySelector<HTMLElement>(`.lotile[data-id="${focusId}"]`)?.focus();
  }, [focusId, draft]);

  const move = (id: string, col: number, index: number) => {
    setDraft(d => moveSection(d, id, col, index));
    setFocusId(id);
  };

  const startDrag = (e: React.PointerEvent<HTMLDivElement>, id: string) => {
    if (e.button > 0 || drag) return;
    const sx = e.clientX,
      sy = e.clientY;
    let current: Drag | null = null;
    trackPointer(e, {
      onMove: ev => {
        if (!current && Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_PX) return;
        current = {id, x: ev.clientX, y: ev.clientY, target: dropTarget(grid.current!, ev.clientX, ev.clientY, id)};
        setDrag(current);
      },
      onEnd: cancelled => {
        setDrag(null);
        if (current && !cancelled) move(id, current.target.col, current.target.index);
      },
    });
  };

  // Arrow keys: up/down within the column, left/right to the neighbouring column (at the same height or below)
  const keyMove = (e: React.KeyboardEvent, id: string) => {
    const ci = draft.cols.findIndex(c => c.includes(id));
    const k = draft.cols[ci].indexOf(id);
    const to = ({ArrowUp: [ci, k - 1], ArrowDown: [ci, k + 1], ArrowLeft: [ci - 1, k], ArrowRight: [ci + 1, k]} as Record<string, number[]>)[e.key];
    if (!to) return;
    e.preventDefault();
    const [col, index] = to;
    if (col < 0 || col >= draft.cols.length || index < 0 || (col === ci && index >= draft.cols[ci].length)) return;
    move(id, col, index);
  };

  const isDefault = sameArrangement(normalizeArrangement(draft, SECTION_IDS, DEFAULT_ARRANGEMENT), DEFAULT_ARRANGEMENT);
  const save = () => {
    saveArrangement(draft, resetSizes);
    close();
  };

  return (
    <div className="rlover" onPointerDown={e => e.target === e.currentTarget && close()}>
      <div className="rlbox lobox" role="dialog" aria-modal="true" aria-labelledby="loTitle">
        <div className="rlhead">
          <b id="loTitle">Dashboard layout</b>
          <button type="button" title="Close without saving" aria-label="Close" onClick={close}>
            ✕
          </button>
        </div>
        <p className="lohint">
          Drag sections between columns to arrange the dashboard; each column stacks its sections top to bottom. With the keyboard: focus a section
          and use the arrow keys.
        </p>
        <div className="logrid" ref={grid} style={{'--n': draft.cols.length} as React.CSSProperties}>
          {draft.cols.map((list, ci) => {
            const marker = drag && drag.target.col === ci ? drag.target.index : -1;
            const others = list.filter(id => id !== drag?.id);
            return (
              <div className="locol" key={ci} data-col={ci}>
                <div className="lohead">
                  Column {ci + 1}
                  {!list.length && draft.cols.length > 1 && (
                    <button
                      type="button"
                      className="lorm"
                      title="Remove this empty column"
                      aria-label={`Remove column ${ci + 1}`}
                      onClick={() => setDraft(d => ({cols: d.cols.filter((_, i) => i !== ci)}))}
                    >
                      ✕
                    </button>
                  )}
                </div>
                {list.map((id, k) => (
                  <Tile
                    key={id}
                    id={id}
                    label={`${SECTIONS[id].title}: column ${ci + 1} of ${draft.cols.length}, position ${k + 1} of ${list.length}. Arrow keys move it.`}
                    dragging={drag?.id === id}
                    markerBefore={marker >= 0 && others[marker] === id}
                    onPointerDown={e => startDrag(e, id)}
                    onKeyDown={e => keyMove(e, id)}
                  />
                ))}
                {marker >= 0 && marker >= others.length && <div className="lodrop" />}
                {!list.length && <div className="loempty">Drop a section here</div>}
              </div>
            );
          })}
        </div>
        <div className="lofoot">
          <button type="button" className="lobtn loaddcol" disabled={draft.cols.length >= MAX_COLS} onClick={() => setDraft(d => ({cols: [...d.cols, []]}))}>
            + Column
          </button>
          <button type="button" className="lobtn lodefault" disabled={isDefault} onClick={() => setDraft(copy(DEFAULT_ARRANGEMENT))}>
            Default layout
          </button>
          <label className="lochk" title="Even out the sizes you set by dragging the dividers">
            <input type="checkbox" checked={resetSizes} onChange={e => setResetSizes(e.target.checked)} /> Reset section sizes
          </label>
          <span className="losp" />
          <button type="button" className="lobtn" onClick={close}>
            Cancel
          </button>
          <button type="button" className="lobtn save" onClick={save}>
            Save layout
          </button>
        </div>
      </div>
      {drag && createPortal(<div className="loghost" style={{left: drag.x, top: drag.y}}>{SECTIONS[drag.id].title}</div>, document.body)}
    </div>
  );
}

interface TileProps {
  id: string;
  label: string;
  dragging: boolean;
  /** Show the drop marker just above this tile. */
  markerBefore: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

function Tile({id, label, dragging, markerBefore, onPointerDown, onKeyDown}: TileProps) {
  return (
    <>
      {markerBefore && <div className="lodrop" />}
      <div
        className={`lotile${dragging ? ' dragging' : ''}`}
        data-id={id}
        tabIndex={0}
        role="button"
        aria-roledescription="movable section"
        aria-label={label}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      >
        <span className="logrip">⋮⋮</span>
        <span className="loname">{SECTIONS[id].title}</span>
      </div>
    </>
  );
}

/** The dialog, while it is open; each opening starts from the saved layout. */
export function LayoutDialog() {
  const open = useUi(s => s.layoutOpen);
  return open ? <LayoutEditor /> : null;
}

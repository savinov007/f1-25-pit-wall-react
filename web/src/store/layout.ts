// How the dashboard is laid out: which sections sit in which column (arranged in the Layout dialog), and the
// sizes set by dragging the dividers, kept as flex weights (px at drag time) so they scale with the window.
// Both are remembered in localStorage.
import {create} from 'zustand';
import {normalizeArrangement, sameArrangement} from '@shared';
import type {Arrangement} from '@shared';
import {KEYS, readJson, write} from '../storage';

/** The dashboard's sections, in their default places. */
export const SECTION_IDS = ['p-driving', 'p-tyres', 'p-lap', 'p-map', 'p-standings', 'p-strategy'];
export const DEFAULT_ARRANGEMENT: Arrangement = {cols: [['p-driving', 'p-tyres'], ['p-lap', 'p-map'], ['p-standings', 'p-strategy']]};

/** Element id (column c1..c4 or section) -> flex weight. */
export type Sizes = Record<string, number>;

interface LayoutState {
  arrangement: Arrangement;
  sizes: Sizes;
}

function initial(): LayoutState {
  const sizes = readJson<Sizes>(KEYS.sizes);
  return {
    arrangement: normalizeArrangement(readJson(KEYS.arrangement), SECTION_IDS, DEFAULT_ARRANGEMENT),
    sizes: sizes && typeof sizes === 'object' ? sizes : {},
  };
}

export const useLayout = create<LayoutState>(initial);
export const resetLayout = () => useLayout.setState(initial(), true);

/** Applies new weights while a divider moves; `persist` stores them once it is let go. */
export function setSizes(update: Sizes, persist = false) {
  const sizes = {...useLayout.getState().sizes, ...update};
  useLayout.setState({sizes});
  if (persist) write(KEYS.sizes, sizes);
}

/**
 * Lays the dashboard out in a new arrangement. A different arrangement (or resetSizes) starts from even sizes:
 * weights saved for the old columns would no longer fit.
 */
export function saveArrangement(draft: Arrangement, resetSizes: boolean) {
  const next = normalizeArrangement(draft, SECTION_IDS, DEFAULT_ARRANGEMENT);
  const {arrangement, sizes} = useLayout.getState();
  const changed = !sameArrangement(next, arrangement);
  write(KEYS.arrangement, sameArrangement(next, DEFAULT_ARRANGEMENT) ? null : next);
  if (changed || resetSizes) write(KEYS.sizes, null);
  useLayout.setState({arrangement: next, sizes: changed || resetSizes ? {} : sizes});
}

// The user's choices: settings (some remembered in localStorage) and which windows are open.
import {create} from 'zustand';
import type {Metric, Rival} from '@shared';
import {KEYS, readText, write} from '../storage';

export type Format = '2025' | '2026';
export type GapMode = 'interval' | 'leader';
export type LapMode = 'last' | 'best';
export type ChartAxis = 'time' | 'dist';
export type LapView = 'cur' | 'last' | 'best';

export const MAX_COMPARE = 4;
export const WEAR_LIMITS = [50, 60, 65, 70, 75, 80];
/** The live compare trace keeps 3 minutes (as much as the server's history) and shows the chosen window of it. */
export const COMPARE_WINDOWS = [20, 60, 180];

export interface Toast {
  content: React.ReactNode;
  /** Bumped for every new toast, so the same message shown twice restarts its timer. */
  id: number;
  ms: number;
}

interface UiState {
  format: Format | null;
  gapMode: GapMode;
  lapMode: LapMode;
  wearLimit: number;
  /** The car shown in the rival popup. */
  selected: number | null;
  compareOpen: boolean;
  /** Compared cars in slot order; the first is the reference. */
  compare: number[];
  metric: Metric;
  axis: ChartAxis;
  lapView: LapView;
  /** Seconds of live trace shown. */
  window: number;
  layoutOpen: boolean;
  replaysOpen: boolean;
  toast: Toast | null;
}

function initial(): UiState {
  const format = readText(KEYS.format);
  const wearLimit = Number(readText(KEYS.wearLimit));
  const window = Number(readText(KEYS.compareWindow));
  return {
    format: format === '2025' || format === '2026' ? format : null,
    gapMode: 'interval',
    lapMode: readText(KEYS.lapMode) === 'best' ? 'best' : 'last',
    wearLimit: wearLimit || 70,
    selected: null,
    compareOpen: false,
    compare: [],
    metric: 'speed',
    axis: 'time',
    lapView: 'cur',
    window: COMPARE_WINDOWS.includes(window) ? window : 20,
    layoutOpen: false,
    replaysOpen: false,
    toast: null,
  };
}

export const useUi = create<UiState>(initial);
/** Back to the stored settings with everything closed (tests, and nothing else). */
export const resetUi = () => useUi.setState(initial(), true);

const set = useUi.setState;
const get = useUi.getState;

export const chooseFormat = (format: Format) => {
  write(KEYS.format, format);
  set({format});
};
export const toggleGapMode = () => set({gapMode: get().gapMode === 'interval' ? 'leader' : 'interval'});
export const toggleLapMode = () => {
  const lapMode: LapMode = get().lapMode === 'last' ? 'best' : 'last';
  write(KEYS.lapMode, lapMode);
  set({lapMode});
};
export const setWearLimit = (wearLimit: number) => {
  write(KEYS.wearLimit, String(wearLimit));
  set({wearLimit});
};

export const openDriver = (idx: number) => set({selected: idx});
export const closeDriver = () => set({selected: null});

/**
 * Opens compare mode. The first time, it starts from a sensible pair: you, plus the driver it was opened from,
 * or the car directly ahead (or the leader).
 */
export function openCompare(rivals: Rival[] = [], withIdx?: number | null) {
  let compare = get().compare;
  if (!compare.length && rivals.length) {
    const me = rivals.find(r => r.player);
    const ahead = me && rivals.find(r => r.pos === me.pos - 1);
    const other = withIdx != null ? null : ahead || rivals[0];
    compare = [...new Set([me, other].filter((r): r is Rival => !!r).map(r => r.idx))];
  }
  if (withIdx != null && !compare.includes(withIdx)) compare = [...compare.slice(0, MAX_COMPARE - 1), withIdx];
  set({compareOpen: true, compare, selected: null});
}
export const closeCompare = () => set({compareOpen: false});
/** Adds a car to the comparison (up to four) or takes it out. */
export function toggleCompared(idx: number) {
  const {compare} = get();
  if (compare.includes(idx)) set({compare: compare.filter(i => i !== idx)});
  else if (compare.length < MAX_COMPARE) set({compare: [...compare, idx]});
}
export const setMetric = (metric: Metric) => set({metric});
export const setAxis = (axis: ChartAxis) => set({axis});
export const setLapView = (lapView: LapView) => set({lapView});
export const setWindow = (window: number) => {
  write(KEYS.compareWindow, String(window));
  set({window});
};

let toastId = 0;
export const showToast = (content: React.ReactNode, ms = 12000) => set({toast: {content, ms, id: ++toastId}});
export const hideToast = () => set({toast: null});

export const setLayoutOpen = (layoutOpen: boolean) => set({layoutOpen});
export const setReplaysOpen = (replaysOpen: boolean) => set({replaysOpen});

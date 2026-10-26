// Chart data: samples for the live traces, lap-distance traces for lap-synced charts, the server's rolling
// per-car history and its compact wire form. Used by the server (recording) and the page (drawing).
import {ERS_MAX} from './constants';
import {ersModeName} from './regulations';
import type {CarStatus, DistPoint, HistorySnapshot, LapData, LapTraces, Telemetry, TimePoint, TraceSample} from './types';

type TelemetryLike = Pick<Telemetry, 'm_speed' | 'm_throttle' | 'm_brake' | 'm_gear'>;
type StatusLike = Pick<CarStatus, 'm_ersStoreEnergy' | 'm_ersDeployMode'> | null | undefined;
type LapLike = Pick<LapData, 'm_currentLapNum' | 'm_lapDistance' | 'm_lastLapTimeInMS' | 'm_currentLapInvalid'>;

const round3 = (v: number) => Math.round(v * 1000) / 1000; // charts don't need more, and history snapshots stay small

/**
 * One chart sample: pedals, gear and the battery (charge 0..1 and deploy mode). Without a status packet yet
 * (it can arrive after the first telemetry) the battery is unknown (null), not an empty battery.
 */
export const traceSample = (t: TelemetryLike, st?: StatusLike): TraceSample => ({
  speed: t.m_speed,
  thr: round3(t.m_throttle),
  brk: round3(t.m_brake),
  gear: t.m_gear,
  ers: st ? round3(Math.max(0, Math.min(1, st.m_ersStoreEnergy / ERS_MAX))) : null,
  mode: st ? st.m_ersDeployMode : null,
});

// A lap trace good enough to be a best-lap reference: starts at the line and has no holes
// (joining mid-lap, or a replay seek, leaves part of the lap unrecorded).
const LAP_HOLE_M = 200;
const wholeLap = (pts: DistPoint[]) =>
  pts.length > 20 && pts[0].d <= LAP_HOLE_M && pts.every((p, i) => !i || p.d - pts[i - 1].d <= LAP_HOLE_M);

/** Adds a sample to car idx's lap traces, rolling the current lap into last/best when a new lap starts. */
export function recordLapTrace(
  traces: Map<number, LapTraces>,
  idx: number,
  t: TelemetryLike,
  lap: LapLike,
  st?: StatusLike
): LapTraces {
  const dist = lap.m_lapDistance,
    lapNum = lap.m_currentLapNum;
  let lt = traces.get(idx);
  if (!lt) {
    lt = {lap: lapNum, cur: [], last: [], lastLap: null, best: [], bestLap: null, bestTime: 0, invalid: false};
    traces.set(idx, lt);
  }
  if (lapNum !== lt.lap) {
    // keep the finished lap only if it was mostly recorded (we may have joined mid-lap)
    if (lt.cur.length > 20) {
      lt.last = lt.cur;
      lt.lastLap = lt.lap;
    }
    // the best lap: fastest fully recorded valid lap, timed by the game (this packet's last lap time)
    const time = lap.m_lastLapTimeInMS;
    if (time > 0 && !lt.invalid && (!lt.bestTime || time < lt.bestTime) && wholeLap(lt.cur)) {
      lt.best = lt.cur;
      lt.bestLap = lt.lap;
      lt.bestTime = time;
    }
    lt.cur = [];
    lt.lap = lapNum;
    lt.invalid = false;
  }
  if (lap.m_currentLapInvalid) lt.invalid = true; // cut a corner: the lap can't be the best
  if (!(dist >= 0)) return lt; // before the start line on lap 1
  let prev = lt.cur[lt.cur.length - 1];
  if (prev && dist < prev.d - 30) {
    // flashback / rewind: drop the part of the lap that was undone
    lt.cur = lt.cur.filter(p => p.d <= dist);
    prev = lt.cur[lt.cur.length - 1];
  }
  if (!prev || dist - prev.d >= 2) lt.cur.push({d: Math.round(dist * 10) / 10, ...traceSample(t, st)});
  return lt;
}

/** Nearest sample to `key` in a list sorted by `field` (binary search). */
export function nearest<P extends Record<F, number>, F extends string>(pts: P[], field: F, key: number): P | null {
  let lo = 0,
    hi = pts.length - 1;
  if (hi < 0) return null;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid][field] < key) lo = mid + 1;
    else hi = mid;
  }
  const a = pts[Math.max(0, lo - 1)],
    b = pts[lo];
  return Math.abs(a[field] - key) <= Math.abs(b[field] - key) ? a : b;
}

/** What the compare chart can plot. */
export type Metric = 'speed' | 'thr' | 'brk' | 'gear' | 'ers' | 'mode';
export const metricValue = (p: Partial<TraceSample>, m: Metric): number | null | undefined =>
  m === 'gear' ? Math.max(0, p.gear as number) : p[m];
export const fmtMetric = (v: number, m: Metric, format?: number): string =>
  m === 'speed'
    ? Math.round(v) + ' km/h'
    : m === 'gear'
    ? v
      ? String(v)
      : 'N'
    : m === 'mode'
    ? ersModeName(v, format) || '–'
    : Math.round(v * 100) + '%';
export const fmtDelta = (v: number, m: Metric): string => {
  const sign = v > 0 ? '+' : v < 0 ? '−' : '±';
  const abs = Math.abs(v);
  return sign + (m === 'speed' ? Math.round(abs) : m === 'gear' ? abs : Math.round(abs * 100) + '%');
};

// --- Rolling per-car history kept by the server, so a chart opened late is already filled ---
// trails: idx -> time samples {t, ...traceSample}; laps: idx -> lap traces as built by recordLapTrace.
// The trail covers the longest live chart window (compare: 3 min).
export const TRAIL_MS = 180000;
const TRAIL_STEP_MS = 50;
export interface History {
  trails: Map<number, TimePoint[]>;
  laps: Map<number, LapTraces>;
}
export const createHistory = (): History => ({trails: new Map(), laps: new Map()});
export function recordHistory(
  h: History,
  idx: number,
  t: TelemetryLike,
  lap: LapLike | null | undefined,
  st: StatusLike,
  now: number
): void {
  let trail = h.trails.get(idx);
  if (!trail) h.trails.set(idx, (trail = []));
  const last = trail[trail.length - 1];
  if (!last || now - last.t >= TRAIL_STEP_MS) trail.push({t: now, ...traceSample(t, st)});
  while (trail.length && now - trail[0].t > TRAIL_MS) trail.shift();
  if (lap) recordLapTrace(h.laps, idx, t, lap, st);
}

// Wire form for one car (null when nothing is recorded). Samples are packed as flat number arrays,
// [x, speed, thr, brk, gear, ers, mode, x, ...], about half the size of objects with repeated keys.
// Trail times become ages (x = a), so client and server clocks needn't agree; lap traces keep x = d.
// A best lap that is also the last lap is sent once ('last').
const SAMPLE_KEYS: (keyof TraceSample)[] = ['speed', 'thr', 'brk', 'gear', 'ers', 'mode'];
const STRIDE = SAMPLE_KEYS.length + 1;
export function packPoints<P extends Partial<TraceSample>>(
  pts: P[],
  x: string,
  xOf: (p: P) => number = p => (p as unknown as Record<string, number>)[x]
): number[] {
  const out: number[] = [];
  for (const p of pts) out.push(xOf(p), ...SAMPLE_KEYS.map(k => p[k] as number));
  return out;
}
function unpackPoints<X extends string>(flat: number[], x: X, xOf: (v: number) => number = v => v) {
  const pts: (TraceSample & Record<X, number>)[] = [];
  for (let i = 0; i + STRIDE <= flat.length; i += STRIDE) {
    const p = {[x]: xOf(flat[i])} as Record<string, number | null>;
    SAMPLE_KEYS.forEach((k, j) => {
      p[k] = flat[i + 1 + j];
    });
    pts.push(p as TraceSample & Record<X, number>);
  }
  return pts;
}
export function historySnapshot(h: History, idx: number, now: number): HistorySnapshot | null {
  const trail = h.trails.get(idx);
  if (!trail) return null;
  const lt = h.laps.get(idx);
  return {
    trail: packPoints(trail, 'a', p => now - p.t),
    lt: lt
      ? {
          ...lt,
          cur: packPoints(lt.cur, 'd'),
          last: packPoints(lt.last, 'd'),
          best: lt.best === lt.last ? 'last' : packPoints(lt.best, 'd'),
        }
      : null,
  };
}
/** The receiving side: the trail on the local clock. */
export const historyTrail = (snap: HistorySnapshot, now: number): TimePoint[] => unpackPoints(snap.trail, 't', a => now - a);
/** The receiving side: lap traces in the shape recordLapTrace builds. */
export function historyLaps(snap: HistorySnapshot): LapTraces | null {
  if (!snap.lt) return null;
  const last = unpackPoints(snap.lt.last, 'd');
  return {
    ...snap.lt,
    cur: unpackPoints(snap.lt.cur, 'd'),
    last,
    best: snap.lt.best === 'last' ? last : unpackPoints(snap.lt.best, 'd'),
  };
}

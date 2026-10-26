// Time series built up from the server messages: pedal traces, compare trails and lap traces, and the track
// outline. They change with every message but are only ever drawn on canvases, so they live here, outside React
// state: updating them re-renders nothing, and the canvases read them on each animation frame.
import {historyLaps, historyTrail, learnTrack, recordLapTrace, traceSample} from '@shared';
import type {DashboardState, LapTraces, Motion, TimePoint, TrackOutline} from '@shared';

/** How far back the driving and rival popup pedal traces go. */
export const PEDAL_TRACE_MS = 10000;
/** How much live trace compare keeps (its longest window). */
export const COMPARE_KEEP_MS = 180000;

export interface PedalSample {
  t: number;
  thr: number;
  brk: number;
}

export const buffers = {
  sessionUID: null as string | null,
  /** The player's pedal trace (driving panel). */
  pedals: [] as PedalSample[],
  /** The selected rival's pedal trace (rival popup). */
  rivalPedals: [] as PedalSample[],
  /** Compared cars: car idx -> live time samples. */
  trails: new Map<number, TimePoint[]>(),
  /** Compared cars: car idx -> lap-distance traces. */
  laps: new Map<number, LapTraces>(),
  track: new Map() as TrackOutline,
  car: null as Motion | null,
  bestLap: 0,
  lastSeenLast: 0,
};

export function resetBuffers(): void {
  buffers.sessionUID = null;
  buffers.pedals = [];
  buffers.rivalPedals = [];
  buffers.trails.clear();
  buffers.laps.clear();
  buffers.track = new Map();
  buffers.car = null;
  buffers.bestLap = 0;
  buffers.lastSeenLast = 0;
}

const trim = <P extends {t: number}>(trail: P[], now: number, keepMs: number) => {
  while (trail.length && now - trail[0].t > keepMs) trail.shift();
};

/** What the page has open, which decides what gets recorded. */
export interface Watching {
  selected: number | null;
  compareOpen: boolean;
}

/** Folds one server message into the buffers. */
export function ingest(s: DashboardState, watching: Watching, now: number): void {
  // a new session resets everything learned about the last one, before this message adds anything
  if (s.session && s.session.sessionUID !== buffers.sessionUID) {
    buffers.sessionUID = s.session.sessionUID;
    buffers.track = new Map();
    buffers.car = null;
    buffers.bestLap = 0;
    buffers.laps.clear();
    buffers.trails.clear();
  }
  learnTrack(buffers.track, s.rivals);

  const d = s.detail;
  if (watching.selected != null && d && d.idx === watching.selected && d.telemetry) {
    // the server recorded this car before the window opened: start from that, replacing anything shown so far
    if (d.history) buffers.rivalPedals = historyTrail(d.history, now).map(({t, thr, brk}) => ({t, thr, brk}));
    buffers.rivalPedals.push({t: now, thr: d.telemetry.m_throttle, brk: d.telemetry.m_brake});
    trim(buffers.rivalPedals, now, PEDAL_TRACE_MS);
  }

  if (watching.compareOpen) {
    for (const c of s.compare || []) {
      // the server has been recording this car all along: start from its history, not from empty
      if (c.history) {
        buffers.trails.set(c.idx, historyTrail(c.history, now));
        const lt = historyLaps(c.history);
        if (lt) buffers.laps.set(c.idx, lt);
      }
      if (!c.telemetry) continue;
      const trail = buffers.trails.get(c.idx) || [];
      trail.push({t: now, ...traceSample(c.telemetry, c.status)});
      trim(trail, now, COMPARE_KEEP_MS);
      buffers.trails.set(c.idx, trail);
      if (c.lap) recordLapTrace(buffers.laps, c.idx, c.telemetry, c.lap, c.status);
    }
  }

  if (s.telemetry) {
    buffers.pedals.push({t: now, thr: s.telemetry.m_throttle, brk: s.telemetry.m_brake});
    trim(buffers.pedals, now, PEDAL_TRACE_MS);
  }
  const last = s.lap && s.lap.m_lastLapTimeInMS;
  if (last && last !== buffers.lastSeenLast) {
    buffers.lastSeenLast = last;
    if (!buffers.bestLap || last < buffers.bestLap) buffers.bestLap = last;
  }
  if (s.motion) buffers.car = s.motion;
}

/** Opening the rival popup starts its trace afresh. */
export const clearRivalPedals = () => {
  buffers.rivalPedals = [];
};

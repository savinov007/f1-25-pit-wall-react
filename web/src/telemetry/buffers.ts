// Time series built up from the server messages: pedal traces, compare trails and lap traces, and the track
// outline. They change with every message but are only ever drawn on canvases, so they live here, outside React
// state: updating them re-renders nothing, and the canvases read them on each animation frame.
import {historyLaps, historyTrail, lapDistance, learnTrack, recordLapTrace, traceSample} from '@shared';
import type {Corner, DashboardState, LapTraces, Motion, TimePoint, TrackOutline} from '@shared';

/** How far back the driving and rival popup pedal traces go. */
export const PEDAL_TRACE_MS = 10000;
/** How much live trace compare keeps (its longest window). */
export const COMPARE_KEEP_MS = 180000;

export interface PedalSample {
  t: number;
  thr: number;
  brk: number;
  /** Metres round the lap, for the corner marks. */
  ld: number | null;
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
  /** Official corner numbers on this track, from a loaded map. */
  corners: [] as Corner[],
  /** The outline came from the server (shipped or learned before): complete, so the cars no longer change it. */
  trackPreloaded: false,
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
  buffers.corners = [];
  buffers.trackPreloaded = false;
  buffers.car = null;
  buffers.bestLap = 0;
  buffers.lastSeenLast = 0;
  mapShown = null;
  mapRequested = null;
}

// --- The outline and official corners for this track, from the server (shipped, or learned the first time the
// track was seen): drawn at once instead of waiting for the cars to drive a lap ---
let mapShown: string | null = null,
  mapRequested: string | null = null;
function syncTrackMap(s: DashboardState): void {
  const tm = s.trackMap;
  const key = tm ? `${tm.trackId}-${tm.trackLength}` : null;
  if (key !== mapShown) {
    mapShown = key;
    mapRequested = null;
    buffers.trackPreloaded = false;
    buffers.corners = [];
  }
  if (!tm || !key || !tm.available || buffers.trackPreloaded || mapRequested === key || typeof fetch !== 'function') return;
  mapRequested = key;
  fetch(`/api/track?id=${tm.trackId}&len=${tm.trackLength}`)
    .then(res => (res.ok ? (res.json() as Promise<{points: [number, number, number][]; corners?: Corner[]}>) : null))
    .then(data => {
      if (!data || mapShown !== key) return; // gone, or another track by now
      buffers.track = new Map(data.points.map(([k, x, z]) => [k, {x, z}]));
      buffers.corners = data.corners || [];
      buffers.trackPreloaded = true;
    })
    .catch(() => {
      if (mapRequested === key) mapRequested = null; // try again with the next message
    });
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
    mapShown = null; // the map is loaded again for the new session
  }
  syncTrackMap(s);
  if (!buffers.trackPreloaded) learnTrack(buffers.track, s.rivals); // a loaded outline is complete already

  const d = s.detail;
  if (watching.selected != null && d && d.idx === watching.selected && d.telemetry) {
    // the server recorded this car before the window opened: start from that, replacing anything shown so far
    if (d.history) buffers.rivalPedals = historyTrail(d.history, now).map(({t, thr, brk, ld}) => ({t, thr, brk, ld}));
    buffers.rivalPedals.push({t: now, thr: d.telemetry.m_throttle, brk: d.telemetry.m_brake, ld: lapDistance(d.lap)});
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
      trail.push({t: now, ...traceSample(c.telemetry, c.status, c.lap)});
      trim(trail, now, COMPARE_KEEP_MS);
      buffers.trails.set(c.idx, trail);
      if (c.lap) recordLapTrace(buffers.laps, c.idx, c.telemetry, c.lap, c.status);
    }
  }

  if (s.telemetry) {
    buffers.pedals.push({t: now, thr: s.telemetry.m_throttle, brk: s.telemetry.m_brake, ld: lapDistance(s.lap)});
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

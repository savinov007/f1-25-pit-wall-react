// Track map: the circuit outline learned from every car, bucketed by lap distance.
import type {Rival} from './types';

export const TRACK_BUCKET_M = 8;
export interface TrackPoint {
  x: number;
  z: number;
}
/** Lap-distance bucket -> smoothed world position. */
export type TrackOutline = Map<number, TrackPoint>;

type CarOnTrack = Pick<Rival, 'pit' | 'result' | 'dist' | 'x' | 'z'>;

/** Adds every car's position to the outline. Pit-lane and inactive cars are skipped so it stays on the circuit. */
export function learnTrack(track: TrackOutline, rivals: CarOnTrack[] | null | undefined): TrackOutline {
  for (const r of rivals || []) {
    if (r.pit || r.result !== 2 || !((r.dist as number) >= 0) || !(r.x || r.z)) continue;
    const x = r.x || 0,
      z = r.z || 0;
    const k = Math.floor((r.dist as number) / TRACK_BUCKET_M);
    // a car teleporting (garage -> grid, flashbacks) reports a position nowhere near its lap distance:
    // ignore points that sit far from an already-known neighbouring bucket
    const near = track.get(k - 1) || track.get(k + 1);
    if (near && Math.hypot(near.x - x, near.z - z) > TRACK_BUCKET_M * 6) continue;
    const p = track.get(k);
    // light smoothing as several cars pass the same spot
    track.set(k, p ? {x: p.x * 0.8 + x * 0.2, z: p.z * 0.8 + z * 0.2} : {x, z});
  }
  return track;
}

/** Coverage limits for outlineComplete (tests lower them). */
export interface CompleteLimits {
  coverage?: number;
  maxGap?: number;
}
/** An outline is complete once nearly every bucket around the lap is known, with no long stretch missing. */
export function outlineComplete(track: TrackOutline, trackLength: number, {coverage = 0.98, maxGap = 4}: CompleteLimits = {}): boolean {
  const n = Math.ceil(trackLength / TRACK_BUCKET_M);
  if (!(n > 0) || track.size < n * coverage) return false;
  let run = 0;
  for (let k = 0; k < n * 2; k++) {
    // twice round, so a gap across the start line counts as one
    run = track.has(k % n) ? 0 : run + 1;
    if (run > maxGap) return false;
  }
  return true;
}

/** [bucket, x, z] */
export type OutlinePoint = [number, number, number];
/**
 * The outline as [[bucket, x, z]] around the lap, without spikes: a point far from both its neighbours is a car
 * that was somewhere else at that lap distance (on the grid, in the garage) before the guard in learnTrack had
 * neighbours to compare with.
 */
export function outlinePoints(track: TrackOutline, trackLength: number): OutlinePoint[] {
  const n = Math.ceil(trackLength / TRACK_BUCKET_M);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  let pts = [...track.keys()].sort((a, b) => a - b).map((k): OutlinePoint => [k, r1(track.get(k)!.x), r1(track.get(k)!.z)]);
  const apart = (a: OutlinePoint, b: OutlinePoint) => {
    const dk = Math.abs(a[0] - b[0]);
    return Math.max(1, Math.min(dk, n - dk)); // round the lap
  };
  const far = (a: OutlinePoint, b: OutlinePoint) => Math.hypot(a[1] - b[1], a[2] - b[2]) > TRACK_BUCKET_M * 3 * apart(a, b);
  for (let changed = true; changed && pts.length > 2; ) {
    const keep = pts.filter((p, i) => !(far(p, pts[(i + pts.length - 1) % pts.length]) && far(p, pts[(i + 1) % pts.length])));
    changed = keep.length < pts.length;
    pts = keep;
  }
  return pts;
}

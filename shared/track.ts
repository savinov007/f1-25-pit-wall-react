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

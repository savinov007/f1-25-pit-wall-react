// Corners: official corner numbers placed on the game's own outline, and where a car went through them.
import {TRACK_BUCKET_M, type OutlinePoint} from './track';
import type {Corner} from './types';

type XY = [number, number];

/** A closed polyline resampled to n points evenly spaced along it. */
function resample(pts: XY[], n: number): XY[] {
  const seg = pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return Math.hypot(q[0] - p[0], q[1] - p[1]);
  });
  const total = seg.reduce((a, b) => a + b, 0);
  const out: XY[] = [];
  for (let k = 0, i = 0, acc = 0; k < n; k++) {
    const at = (k / n) * total;
    while (i < seg.length - 1 && acc + seg[i] < at) acc += seg[i++];
    const f = seg[i] ? (at - acc) / seg[i] : 0,
      p = pts[i],
      q = pts[(i + 1) % pts.length];
    out.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]);
  }
  return out;
}

/** Best rotation + scale + shift taking points a onto b (2D Procrustes): {err, apply(p)}, err as an RMS distance. */
function similarity(a: XY[], b: XY[]) {
  const n = a.length,
    ma = [0, 0],
    mb = [0, 0];
  for (let i = 0; i < n; i++) {
    ma[0] += a[i][0] / n;
    ma[1] += a[i][1] / n;
    mb[0] += b[i][0] / n;
    mb[1] += b[i][1] / n;
  }
  let dot = 0,
    cross = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < n; i++) {
    const ax = a[i][0] - ma[0],
      ay = a[i][1] - ma[1],
      bx = b[i][0] - mb[0],
      by = b[i][1] - mb[1];
    dot += ax * bx + ay * by;
    cross += ax * by - ay * bx;
    na += ax * ax + ay * ay;
    nb += bx * bx + by * by;
  }
  const c = dot / na,
    s = cross / na; // scale * cos, scale * sin
  return {
    err: Math.sqrt(Math.max(0, nb - (dot * dot + cross * cross) / na) / n),
    apply: (p: XY): XY => [c * (p[0] - ma[0]) - s * (p[1] - ma[1]) + mb[0], s * (p[0] - ma[0]) + c * (p[1] - ma[1]) + mb[1]],
  };
}

/**
 * When time samples ({t, ld}) went through each corner ({n, d}): [{t, n}]. Samples are tens of milliseconds apart,
 * so a car covers a few metres between them: going further than CORNER_JUMP_M, forwards or over the start line,
 * is a replay seek, and any other step back a flashback or seek; neither is driving through a corner.
 */
const CORNER_JUMP_M = 300;
export function cornerPasses(
  samples: {t: number; ld?: number | null}[],
  corners: Corner[] | null | undefined,
  trackLength: number | null | undefined
): {t: number; n: string}[] {
  const out: {t: number; n: string}[] = [];
  if (!corners || !corners.length) return out;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1].ld,
      b = samples[i].ld;
    if (a == null || b == null) continue;
    const wrapped = !!trackLength && trackLength > 0 && b < a && trackLength - a + b <= CORNER_JUMP_M; // over the line
    if (!wrapped && (b < a || b - a > CORNER_JUMP_M)) continue;
    for (const c of corners) {
      if (wrapped ? c.d > a || c.d <= b : c.d > a && c.d <= b) out.push({t: samples[i].t, n: c.n});
    }
  }
  return out;
}

/** The corner within `within` metres of a lap distance, or null. */
export function cornerAt(corners: Corner[] | null | undefined, d: number, within = 60): Corner | null {
  let best: Corner | null = null;
  for (const c of corners || []) if (Math.abs(c.d - d) <= within && (!best || Math.abs(c.d - d) < Math.abs(best.d - d))) best = c;
  return best;
}

/** Official circuit data for one track, in its own coordinate system. */
export interface OfficialCircuit {
  outline: XY[];
  corners: {n: string; x: number; y: number}[];
}

const FIT_N = 256,
  FIT_MAX_ERR = 0.03;
/**
 * Official corners placed on the game outline (points: [[bucket, x, z]] around the lap): [{n, d}] with d in metres
 * of lap distance, sorted by d. The official outline is fitted onto the game's trying both directions, a mirror
 * image (the axes may be flipped) and every start point, so the game's lap distance stays the authority. A poor
 * fit, or corners that come out of order along the lap, gives [] rather than wrong numbers.
 */
export function fitCorners(points: OutlinePoint[] | null | undefined, official: OfficialCircuit | null | undefined): Corner[] {
  if (!official || !points || points.length < 16 || !official.outline || official.outline.length < 16) return [];
  const game = resample(points.map((p): XY => [p[1], p[2]]), FIT_N);
  let best: (ReturnType<typeof similarity> & {mirror: number}) | null = null;
  for (const mirror of [1, -1]) {
    for (const reverse of [false, true]) {
      const src = official.outline.map(([x, y]): XY => [x, y * mirror]);
      if (reverse) src.reverse();
      const ref = resample(src, FIT_N);
      for (let off = 0; off < FIT_N; off++) {
        const fit = similarity(ref.slice(off).concat(ref.slice(0, off)), game);
        if (!best || fit.err < best.err) best = {...fit, mirror};
      }
    }
  }
  const fit = best!;
  const cx = game.reduce((a, p) => a + p[0], 0) / FIT_N,
    cz = game.reduce((a, p) => a + p[1], 0) / FIT_N;
  const size = Math.sqrt(game.reduce((a, p) => a + (p[0] - cx) ** 2 + (p[1] - cz) ** 2, 0) / FIT_N);
  if (!(fit.err <= size * FIT_MAX_ERR)) return [];
  const placed = official.corners.map(c => {
    const [x, z] = fit.apply([c.x, c.y * fit.mirror]);
    let k = points[0][0],
      dist = Infinity;
    for (const p of points) {
      const dd = (p[1] - x) ** 2 + (p[2] - z) ** 2;
      if (dd < dist) {
        dist = dd;
        k = p[0];
      }
    }
    return {n: c.n, d: k * TRACK_BUCKET_M + TRACK_BUCKET_M / 2};
  });
  // in official order the corners go round the lap once: at most one step back (across the start line)
  const backs = placed.filter((c, i) => i && c.d < placed[i - 1].d).length;
  if (backs > 1) return [];
  return placed.sort((a, b) => a.d - b.d);
}

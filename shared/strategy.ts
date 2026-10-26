// Strategy projections from the rates the server measures (strategy.js): tyre life, rejoin position, battles.
import {TYRES, type TyreCorner} from './constants';
import {fmtS, leaderGap} from './format';
import type {CarStrategy, Rival} from './types';

export interface CornerProjection {
  n: TyreCorner['n'];
  wear: number;
  rate: number | null;
  /** Laps until the wear limit: Infinity when not wearing, 0 when already past, null when unknown. */
  left: number | null;
}
export interface TyreProjection {
  corners: CornerProjection[];
  worst: CornerProjection | null;
}

/** Laps until each corner reaches the wear limit, and the corner that gets there first. */
export function tyreProjection(st: CarStrategy | null | undefined, limit: number): TyreProjection | null {
  if (!st || !st.wear) return null;
  const wear = st.wear;
  const corners = TYRES.map((ty): CornerProjection => {
    const w = wear[ty.i],
      rate = st.wearRate ? st.wearRate[ty.i] ?? null : null;
    const left = w >= limit ? 0 : rate == null ? null : rate > 0.05 ? (limit - w) / rate : Infinity;
    return {n: ty.n, wear: w, rate, left};
  });
  const known = corners.filter(c => c.left != null);
  const worst = known.length ? known.reduce((a, b) => ((b.left as number) < (a.left as number) ? b : a)) : null;
  return {corners, worst};
}

/** Colour for a laps-left number: red under 3, amber under 6. */
export const lapsColor = (n: number | null | undefined): string =>
  n == null || !isFinite(n) ? 'var(--green)' : n < 3 ? 'var(--red-hi)' : n < 6 ? 'var(--amber)' : 'var(--green)';

type Timed = Pick<Rival, 'pos' | 'gapLeader'>;
export interface Rejoin<R> {
  pos: number;
  ahead?: {r: R; g: number};
  behind?: {r: R; g: number};
  /** Your gap to the leader after the stop, ms. */
  after: number;
}
/** Where you'd come out if you pitted now: your gap to the leader plus the measured pit loss. */
export function rejoinEstimate<R extends Timed & Partial<Pick<Rival, 'player' | 'result'>>>(
  s: {pitLoss?: {ms: number} | null; rivals?: R[]},
  me: Timed | null | undefined
): Rejoin<R> | null {
  if (!s.pitLoss || !me) return null;
  const mine = leaderGap(me);
  if (mine == null) return null;
  const after = mine + s.pitLoss.ms;
  const others = (s.rivals || [])
    .filter(r => !r.player && r.result === 2)
    .map(r => ({r, g: leaderGap(r)}))
    .filter((o): o is {r: R; g: number} => o.g != null)
    .sort((a, b) => a.g - b.g);
  const ahead = others.filter(o => o.g <= after),
    behind = others.filter(o => o.g > after);
  return {pos: ahead.length + 1, ahead: ahead[ahead.length - 1], behind: behind[0], after};
}

export interface Trend {
  text: string;
  cls: 'dim' | 'good' | 'bad';
}
/** How a gap is moving, from your point of view. chasing = the car is ahead of you. */
export function battleTrend(gapMs: number, rateMs: number | null | undefined, chasing: boolean): Trend {
  if (rateMs == null) return {text: 'measuring…', cls: 'dim'};
  const lapsTo = (target: number) => Math.max(1, Math.ceil((gapMs - target) / -rateMs));
  if (rateMs < -30) {
    const drs = gapMs > 1000 ? `DRS in ${lapsTo(1000)} lap${lapsTo(1000) === 1 ? '' : 's'}` : 'in DRS range';
    return {text: `${chasing ? 'catching' : 'closing'} ${fmtS(-rateMs)}s/lap · ${drs}`, cls: chasing ? 'good' : 'bad'};
  }
  if (rateMs > 30) return {text: `${chasing ? 'pulling away' : 'dropping back'} ${fmtS(rateMs)}s/lap`, cls: chasing ? 'bad' : 'good'};
  return {text: 'holding the gap', cls: 'dim'};
}

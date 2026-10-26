// Corner numbers on a time chart: a faint line and the number where the trace went through each corner.
import {cornerPasses} from '@shared';
import type {Corner} from '@shared';
import {DISPLAY_FONT} from './fonts';

export interface CornerMarks {
  corners: Corner[];
  trackLength: number | null | undefined;
}

/**
 * xOf maps an x within [0, plotW] to the canvas (for a left margin); `span` is the ms the chart covers up to `now`;
 * the numbers go at `top` and the lines run down to `bottom`.
 */
export function drawCornerPasses(
  ctx: CanvasRenderingContext2D,
  trail: {t: number; ld?: number | null}[],
  {corners, trackLength}: CornerMarks,
  o: {xOf: (x: number) => number; now: number; span: number; plotW: number; top: number; bottom: number}
): void {
  const passes = cornerPasses(trail, corners, trackLength);
  if (!passes.length) return;
  ctx.save();
  ctx.font = `700 9px ${DISPLAY_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const p of passes) {
    const x = Math.round(o.xOf(o.plotW - ((o.now - p.t) / o.span) * o.plotW)) + 0.5;
    if (x < o.xOf(0) || x > o.xOf(o.plotW)) continue;
    ctx.strokeStyle = 'rgba(236, 238, 243, .08)';
    ctx.beginPath();
    ctx.moveTo(x, o.top + 11);
    ctx.lineTo(x, o.bottom);
    ctx.stroke();
    ctx.fillStyle = '#7a8195';
    ctx.fillText('T' + p.n, x, o.top + 1);
  }
  ctx.restore();
}

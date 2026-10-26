// Compare chart: one metric for up to four drivers, against time (the live trace) or lap distance (lap-synced),
// with a hover readout of every driver's value and the delta to the reference (first) driver.
import {SLOT_COLORS, fmtClock, fmtDelta, fmtMetric, metricValue, nearest} from '@shared';
import type {DistPoint, LapTraces, Metric, TimePoint} from '@shared';
import type {ChartAxis, LapView} from '../store/ui';
import {DISPLAY_FONT} from './fonts';

/** ERS deploy mode axis labels, short enough for the chart's left margin. */
const modeTick = (mode: number, format?: number) => ['NONE', 'MED', 'HOT', (format ?? 0) >= 2026 ? 'BOOST' : 'OT'][mode];

const EMPTY_LAP: Record<LapView, string> = {
  cur: 'WAITING FOR CARS TO CROSS THE LINE',
  last: 'NO COMPLETED LAP RECORDED YET',
  best: 'NO FULL VALID LAP RECORDED YET',
};

export const PAD = {l: 44, r: 8, t: 8, b: 18};

export interface CompareChartInput {
  /** Compared cars in slot order: their name and recorded data. */
  slots: {name: string; trail: TimePoint[] | undefined; laps: LapTraces | undefined}[];
  metric: Metric;
  axis: ChartAxis;
  lapView: LapView;
  /** Seconds of live trace shown. */
  window: number;
  trackLength: number | null | undefined;
  format: number | undefined;
  /** Pointer x over the canvas, or null. */
  hoverX: number | null;
  now: number;
}

type Point = (TimePoint | DistPoint) & Record<string, number | null>;

export function drawCompareChart(ctx: CanvasRenderingContext2D, w: number, h: number, input: CompareChartInput): void {
  const {slots, metric, axis, lapView, window: windowS, trackLength, format, hoverX, now} = input;
  const byDist = axis === 'dist';
  const field = byDist ? 'd' : 't';

  // series per slot: points sorted by the x field ('t' for time, 'd' for distance)
  let series = slots.map(s => ((byDist ? s.laps?.[lapView] : s.trail) || []) as Point[]);
  let xMin: number, xMax: number;
  if (byDist) {
    let seen = 0;
    for (const pts of series) if (pts.length) seen = Math.max(seen, pts[pts.length - 1].d as number);
    xMin = 0;
    xMax = trackLength || Math.max(seen, 1000);
  } else {
    xMax = now;
    xMin = now - windowS * 1000;
    // the trail holds 3 min: draw only the window (one sample before it, so the line reaches the edge)
    series = series.map(pts => {
      const first = pts.findIndex(p => (p.t as number) >= xMin);
      return first < 0 ? [] : pts.slice(Math.max(0, first - 1));
    });
  }

  let max = metric === 'speed' ? 350 : metric === 'gear' ? 8 : metric === 'mode' ? 3 : 1;
  if (metric === 'speed') for (const pts of series) for (const p of pts) max = Math.max(max, p.speed as number);
  const plotW = w - PAD.l - PAD.r,
    plotH = h - PAD.t - PAD.b;
  const xOf = (v: number) => PAD.l + ((v - xMin) / (xMax - xMin)) * plotW;
  const yOf = (v: number) => PAD.t + plotH - (v / max) * plotH;

  // grid + axis labels
  ctx.font = `600 10px ${DISPLAY_FONT}`;
  ctx.fillStyle = '#7a8195';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = '#171a24';
  ctx.lineWidth = 1;
  const ticks = metric === 'gear' ? [0, 2, 4, 6, 8] : metric === 'mode' ? [0, 1, 2, 3] : [0, 0.25, 0.5, 0.75, 1].map(f => f * max);
  for (const v of ticks) {
    const y = Math.round(yOf(v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(PAD.l, y);
    ctx.lineTo(w - PAD.r, y);
    ctx.stroke();
    const label = metric === 'speed' ? String(Math.round(v)) : metric === 'gear' ? String(v) : metric === 'mode' ? modeTick(v, format) : Math.round(v * 100) + '%';
    ctx.fillText(label, PAD.l - 8, y);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  if (byDist) {
    const step = xMax > 4000 ? 1000 : 500;
    for (let d = 0; d <= xMax; d += step) {
      const x = xOf(d);
      ctx.strokeStyle = '#141720';
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, PAD.t);
      ctx.lineTo(Math.round(x) + 0.5, PAD.t + plotH);
      ctx.stroke();
      ctx.fillText(d ? (d / 1000).toFixed(d % 1000 ? 1 : 0) + ' km' : 'START', x, h - 4);
    }
  } else {
    const step = windowS <= 20 ? 5 : windowS <= 60 ? 15 : 30;
    for (let sec = 0; sec <= windowS; sec += step) {
      ctx.fillText(sec ? (sec < 60 ? `-${sec}s` : `-${fmtClock(sec)}`) : 'now', xOf(now - sec * 1000), h - 4);
    }
  }

  // traces
  series.forEach((pts, k) => {
    if (pts.length < 2) return;
    ctx.beginPath();
    let started = false,
      prevY = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      // don't join across gaps in the recorded lap (we joined mid-lap, or skipped samples)
      const gap = byDist && i > 0 && (p.d as number) - (pts[i - 1].d as number) > 60;
      const v = metricValue(p, metric);
      if (v == null) {
        started = false; // unknown here (no battery data yet): leave a gap
        continue;
      }
      const x = xOf(p[field] as number),
        y = yOf(v);
      if (!started || gap) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        if (metric === 'mode') ctx.lineTo(x, prevY); // deploy mode is a step, not a ramp
        ctx.lineTo(x, y);
      }
      prevY = y;
    }
    ctx.strokeStyle = SLOT_COLORS[k];
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.shadowColor = SLOT_COLORS[k];
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;
  });

  if (byDist && series.every(p => p.length < 2)) {
    ctx.fillStyle = '#7a8195';
    ctx.textAlign = 'center';
    ctx.font = `600 12px ${DISPLAY_FONT}`;
    ctx.fillText(EMPTY_LAP[lapView], PAD.l + plotW / 2, PAD.t + plotH / 2);
  }

  if (hoverX == null || hoverX < PAD.l || hoverX > PAD.l + plotW) return;
  drawHover(ctx, {series, slots, metric, byDist, field, format, hoverX, now, w, plotW, plotH, key: xMin + ((hoverX - PAD.l) / plotW) * (xMax - xMin), yOf});
}

// hover crosshair: every driver's value at the same point, with the delta to the reference (first) driver
function drawHover(
  ctx: CanvasRenderingContext2D,
  o: {
    series: Point[][];
    slots: CompareChartInput['slots'];
    metric: Metric;
    byDist: boolean;
    field: 't' | 'd';
    format: number | undefined;
    hoverX: number;
    now: number;
    w: number;
    plotW: number;
    plotH: number;
    key: number;
    yOf: (v: number) => number;
  }
) {
  const {series, slots, metric, byDist, field, format, hoverX, now, w, plotH, key, yOf} = o;
  const tolerance = byDist ? 40 : 300; // metres / ms
  let refVal: number | null = null;
  const rows = series.map((pts, k) => {
    const p = nearest(pts as Record<string, number>[], field, key) as Point | null;
    const ok = p && Math.abs((p[field] as number) - key) <= tolerance;
    const v = ok ? metricValue(p!, metric) ?? null : null;
    if (k === 0) refVal = v;
    return {k, v, name: slots[k].name.slice(0, 12).toUpperCase(), y: v == null ? null : yOf(v)};
  });
  ctx.strokeStyle = 'rgba(236, 238, 243, .35)';
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(hoverX + 0.5, PAD.t);
  ctx.lineTo(hoverX + 0.5, PAD.t + plotH);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const r of rows) {
    if (r.y == null) continue;
    ctx.beginPath();
    ctx.arc(hoverX, r.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = SLOT_COLORS[r.k];
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#07080b';
    ctx.stroke();
  }
  // readout box
  const title = byDist ? `${Math.round(key)} m` : `${((now - key) / 1000).toFixed(1)} s ago`;
  ctx.font = `600 11px ${DISPLAY_FONT}`;
  const lineH = 15,
    boxW = 190,
    boxH = 10 + lineH * (rows.length + 1);
  let bx = hoverX + 12;
  if (bx + boxW > w - PAD.r) bx = hoverX - 12 - boxW;
  const by = PAD.t + 4;
  ctx.fillStyle = 'rgba(10, 11, 16, .92)';
  ctx.strokeStyle = '#2b3042';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(bx, by, boxW, boxH, 6);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.fillStyle = '#7a8195';
  ctx.fillText(title, bx + 10, by + 4 + lineH - 3);
  rows.forEach((r, i) => {
    const y = by + 4 + lineH * (i + 2) - 3;
    ctx.fillStyle = SLOT_COLORS[r.k];
    ctx.fillRect(bx + 10, y - 8, 3, 10);
    ctx.fillStyle = '#eceef3';
    ctx.textAlign = 'left';
    ctx.fillText(r.name, bx + 18, y);
    ctx.textAlign = 'right';
    const val = r.v == null ? '–' : fmtMetric(r.v, metric, format);
    // no delta for the deploy mode: it is a category, "+1 mode" means nothing
    const withDelta = r.k > 0 && refVal != null && r.v != null && metric !== 'mode';
    ctx.fillText(val, bx + boxW - (withDelta ? 58 : 10), y);
    if (withDelta) {
      const dlt = (r.v as number) - (refVal as number);
      ctx.fillStyle = metric === 'brk' ? '#7a8195' : dlt > 0 ? '#1fd166' : dlt < 0 ? '#ff2d1f' : '#7a8195';
      ctx.fillText(fmtDelta(dlt, metric), bx + boxW - 10, y);
    }
  });
}

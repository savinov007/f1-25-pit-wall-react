// Rolling throttle and brake trace: the last 10 seconds, newest on the right.
import {PEDAL_TRACE_MS, type PedalSample} from '../telemetry/buffers';

export function drawPedalTrace(ctx: CanvasRenderingContext2D, w: number, h: number, trail: PedalSample[], now: number): void {
  ctx.strokeStyle = '#161923';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = Math.round((h * i) / 4) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  const series = (key: 'thr' | 'brk', rgb: string) => {
    const pts = trail.map(s => [w - ((now - s.t) / PEDAL_TRACE_MS) * w, h - 3 - s[key] * (h - 6)]);
    if (pts.length < 2) return;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, `rgba(${rgb}, .32)`);
    grad.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], h);
    for (const [x, y] of pts) ctx.lineTo(x, y);
    ctx.lineTo(pts[pts.length - 1][0], h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.strokeStyle = `rgb(${rgb})`;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
  };
  series('thr', '31, 209, 102');
  series('brk', '255, 45, 31');
}

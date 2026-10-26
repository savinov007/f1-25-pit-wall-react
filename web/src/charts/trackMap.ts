// Track map: the learned outline, 2026 active aero and DRS zones, every rival and your car.
import {TRACK_BUCKET_M, zoneRanges} from '@shared';
import type {Motion, Rival, Session, TrackOutline, Zone} from '@shared';
import {DISPLAY_FONT} from './fonts';

export const AERO_ZONE_COLOR = 'rgba(51, 214, 232, .9)';
export const DRS_ZONE_COLOR = 'rgba(31, 209, 102, .9)';

export interface MapInput {
  track: TrackOutline;
  rivals: Rival[];
  car: Motion | null;
  session: Session | null | undefined;
}

export function drawTrackMap(ctx: CanvasRenderingContext2D, w: number, h: number, {track, rivals: all, car, session}: MapInput): void {
  const rivals = all.filter(r => !r.player && (r.x || r.z)) as (Rival & {x: number; z: number})[];
  const keys = [...track.keys()].sort((a, b) => a - b);
  const pts = [...keys.map(k => track.get(k)!), ...rivals, ...(car ? [car] : [])];
  if (pts.length < 2) {
    ctx.fillStyle = '#7a8195';
    ctx.textAlign = 'center';
    ctx.font = `600 12px ${DISPLAY_FONT}`;
    ctx.fillText('WAITING FOR CARS ON TRACK', w / 2, h / 2);
    return;
  }
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const pad = 22,
    spanX = maxX - minX || 1,
    spanZ = maxZ - minZ || 1;
  const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanZ);
  const ox = (w - spanX * scale) / 2,
    oy = (h - spanZ * scale) / 2;
  const px = (p: {x: number}) => ox + (p.x - minX) * scale,
    py = (p: {z: number}) => oy + (p.z - minZ) * scale;

  // outline: connect consecutive buckets, break the line across gaps not yet driven
  if (keys.length > 1) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    keys.forEach((k, i) => {
      const p = track.get(k)!;
      if (i && k - keys[i - 1] <= 4) ctx.lineTo(px(p), py(p));
      else ctx.moveTo(px(p), py(p));
    });
    const first = track.get(keys[0])!,
      last = track.get(keys[keys.length - 1])!;
    if (Math.hypot(first.x - last.x, first.z - last.z) < TRACK_BUCKET_M * 6) ctx.lineTo(px(first), py(first));
    ctx.strokeStyle = '#1c2030';
    ctx.lineWidth = 12;
    ctx.stroke();
    ctx.strokeStyle = '#2b3042';
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(225, 6, 0, .75)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // 2026: active aero zones (cyan) and DRS zones (green) along the learned outline
  const drawZones = (ranges: Zone[], color: string) => {
    if (!ranges.length) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    for (const [from, to] of ranges) {
      ctx.beginPath();
      let prev: number | null = null;
      for (const k of keys) {
        const d = k * TRACK_BUCKET_M;
        if (d < from || d > to) {
          prev = null;
          continue;
        }
        const p = track.get(k)!;
        if (prev !== null && k - prev <= 4) ctx.lineTo(px(p), py(p));
        else ctx.moveTo(px(p), py(p));
        prev = k;
      }
      ctx.stroke();
    }
  };
  if (session && keys.length > 1) {
    drawZones(zoneRanges(session.aeroZones, session.trackLength), AERO_ZONE_COLOR);
    drawZones(zoneRanges(session.drsZones, session.trackLength), DRS_ZONE_COLOR);
  }

  ctx.font = `700 11px ${DISPLAY_FONT}`;
  ctx.textAlign = 'center';
  for (const r of rivals) {
    const x = px(r),
      y = py(r);
    ctx.globalAlpha = r.result > 3 ? 0.35 : r.pit ? 0.6 : 1;
    ctx.beginPath();
    ctx.arc(x, y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = r.color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#07080b';
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(7, 8, 11, .85)';
    const label = r.name.slice(0, 3).toUpperCase();
    ctx.strokeText(label, x, y - 10);
    ctx.fillStyle = '#eceef3';
    ctx.fillText(label, x, y - 10);
    ctx.globalAlpha = 1;
  }
  if (car) {
    ctx.beginPath();
    ctx.arc(px(car), py(car), 7, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 14;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#e10600';
    ctx.stroke();
  }
}

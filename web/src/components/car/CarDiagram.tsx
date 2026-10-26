// Top-down car: tyres coloured by surface temperature with the tread draining as they wear, body parts tinted by
// damage, and a callout per corner with wear, temperatures, pressure and brake temperature.
import {memo, useId} from 'react';
import {CAR_PARTS, DMG_COLORS, TYRES, dmgLevel, tempColor, wearColor} from '@shared';
import type {CarDamage, Telemetry, TyreCorner} from '@shared';

type TyreTelemetry = Pick<Telemetry, 'm_tyresSurfaceTemperature' | 'm_tyresInnerTemperature' | 'm_tyresPressure' | 'm_brakesTemperature'>;

interface Props {
  telemetry: TyreTelemetry | null | undefined;
  damage: CarDamage | null | undefined;
}

const clampWear = (w: number) => Math.max(0, Math.min(100, w));

function TyreCallout({ty, telemetry, wear}: {ty: TyreCorner; telemetry: Props['telemetry']; wear: number | null}) {
  const surface = telemetry?.m_tyresSurfaceTemperature[ty.i];
  const brake = telemetry?.m_brakesTemperature?.[ty.i];
  const wearCol = wear == null ? undefined : wearColor(wear);
  return (
    <div className={`ti ${ty.area} ${ty.side}`}>
      <div className="ti-top">
        <span className="ti-name">{ty.n}</span>
        <span className="ti-wear" style={{color: wearCol}}>
          <b>{wear == null ? '–' : Math.round(wear)}</b>
          <small>%</small>
          <em>WEAR</em>
        </span>
      </div>
      <div className="ti-meter">
        <i style={wear == null ? undefined : {width: wear + '%', background: wearCol}} />
      </div>
      <dl className="ti-stats">
        <div>
          <dt>SURF</dt>
          <dd style={{color: surface == null ? undefined : tempColor(surface)}}>{surface == null ? '–' : Math.round(surface) + '°'}</dd>
        </div>
        <div>
          <dt>INNER</dt>
          <dd>{telemetry ? Math.round(telemetry.m_tyresInnerTemperature[ty.i]) + '°' : '–'}</dd>
        </div>
        <div>
          <dt>PSI</dt>
          <dd>{telemetry ? telemetry.m_tyresPressure[ty.i].toFixed(1) : '–'}</dd>
        </div>
        <div>
          <dt>BRAKE</dt>
          <dd>{brake == null ? '–' : Math.round(brake) + '°'}</dd>
        </div>
      </dl>
    </div>
  );
}

export const CarDiagram = memo(function CarDiagram({telemetry, damage}: Props) {
  const id = useId().replace(/:/g, '');
  const wear = TYRES.map(ty => (damage?.m_tyresWear ? clampWear(damage.m_tyresWear[ty.i]) : null));
  const partFill = (key: (typeof CAR_PARTS)[number][1]) => (damage ? DMG_COLORS[dmgLevel(damage[key] || 0)] : '');
  const part = (cls: string) => {
    const entry = CAR_PARTS.find(([c]) => c === cls)!;
    return {className: `part ${cls}`, style: {fill: partFill(entry[1]) || undefined}};
  };
  return (
    <div className="carw">
      {TYRES.map((ty, k) => (
        <TyreCallout key={ty.n} ty={ty} telemetry={telemetry} wear={wear[k]} />
      ))}
      <svg className="carsvg" viewBox="0 0 100 200" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <defs>
          <pattern id={`${id}-worn`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" fill="#0a0b10" />
            <rect width="1.6" height="5" fill="#232836" />
          </pattern>
          {TYRES.map((ty, k) => (
            <clipPath key={ty.n} id={`${id}-c${k}`}>
              <rect x={ty.x} y={ty.y} width={ty.w} height={ty.h} rx="5" />
            </clipPath>
          ))}
        </defs>
        <g className="susp">
          <line x1="24" y1="38" x2="46" y2="34" /><line x1="24" y1="58" x2="46" y2="60" />
          <line x1="76" y1="38" x2="54" y2="34" /><line x1="76" y1="58" x2="54" y2="60" />
          <line x1="25" y1="142" x2="36" y2="138" /><line x1="25" y1="162" x2="36" y2="164" />
          <line x1="75" y1="142" x2="64" y2="138" /><line x1="75" y1="162" x2="64" y2="164" />
        </g>
        <path {...part('floor')} d="M40 64 L60 64 L74 92 L74 150 L66 172 L34 172 L26 150 L26 92 Z" />
        <rect {...part('spl')} x="27" y="86" width="11" height="48" rx="4" />
        <rect {...part('spr')} x="62" y="86" width="11" height="48" rx="4" />
        <path className="part body" d="M46 16 L54 16 L57 58 L63 72 L66 118 L61 168 L39 168 L34 118 L37 72 L43 58 Z" />
        <ellipse cx="50" cy="96" rx="6" ry="12" fill="#07080b" stroke="#363c50" strokeWidth=".8" />
        <rect {...part('fwl')} x="4" y="6" width="45" height="10" rx="2" />
        <rect {...part('fwr')} x="51" y="6" width="45" height="10" rx="2" />
        <rect {...part('dif')} x="34" y="170" width="32" height="6" rx="1.5" />
        <rect {...part('rw')} x="18" y="180" width="64" height="12" rx="2" />
        {TYRES.map((ty, k) => {
          const surface = telemetry?.m_tyresSurfaceTemperature[ty.i];
          const col = surface == null ? undefined : tempColor(surface);
          return (
            <g key={ty.n}>
              <g clipPath={`url(#${id}-c${k})`}>
                <rect className="tread" x={ty.x} y={ty.y} width={ty.w} height={ty.h} fill={col || '#2a2f40'} />
                <rect className="worn" x={ty.x} y={ty.y} width={ty.w} height={((wear[k] ?? 0) * ty.h) / 100} fill={`url(#${id}-worn)`} />
              </g>
              <rect className="rim" x={ty.x} y={ty.y} width={ty.w} height={ty.h} rx="5" stroke={col || '#363c50'} />
            </g>
          );
        })}
      </svg>
    </div>
  );
});

// The DRS badge (pre-2026 cars), or for 2026 cars the battery gauge with the ERS mode, plus the active aero badge.
import {ERS_MAX, aeroLabel, boostBadge, ersModeName, overtakeReady} from '@shared';
import type {BoostBadge, CarStatus, Telemetry, Telemetry2} from '@shared';

interface BatteryProps {
  status: CarStatus;
  badge: BoostBadge;
  telemetry2: Telemetry2 | null | undefined;
  sessionType: number | undefined;
  className?: string;
}

/** ERS charge as a battery: blue while the driver has overtake mode, green with charge, red when nearly empty. */
export function Battery({status, badge, telemetry2, sessionType, className = ''}: BatteryProps) {
  const pct = Math.max(0, Math.min(100, (status.m_ersStoreEnergy / ERS_MAX) * 100));
  const mode = ersModeName(status.m_ersDeployMode, badge.label === 'OVERTAKE' ? 2026 : 2025).toUpperCase();
  const boosting = status.m_ersDeployMode === 3; // ERS Boost: the game's own signal, whatever the overtake flags say
  const ot = boosting || overtakeReady(telemetry2, sessionType);
  const title =
    `Battery ${Math.round(pct)}% · ERS mode: ${mode || 'unknown'}` +
    (ot && !boosting ? ' · overtake mode available' : '') +
    (boosting ? ' · overtake mode in use' : badge.wait ? ` · overtake available in ${badge.wait} m` : '');
  const cls = ['bat', className, pct < 15 && 'low', ot && 'ot', boosting && 'boost'].filter(Boolean).join(' ');
  return (
    <div className={cls} title={title}>
      <div className="batrow">
        <div className="batbody">
          <i className="batfill" style={{width: pct + '%'}} />
          <span className="batpct">{Math.round(pct)}</span>
        </div>
        <span className="batcap" />
      </div>
      <div className="batlbl" data-mode={mode.toLowerCase()}>
        {mode || '–'}
      </div>
    </div>
  );
}

interface BadgesProps {
  telemetry: Telemetry | null | undefined;
  telemetry2: Telemetry2 | null | undefined;
  status: CarStatus | null | undefined;
  sessionType: number | undefined;
  /** The active aero badge is left out of the compact compare columns. */
  showAero?: boolean;
  /** Extra classes for the DRS badge and the battery (compare columns style their own). */
  drsClass?: string;
  batClass?: string;
}

export function Badges({telemetry, telemetry2, status, sessionType, showAero = true, drsClass = '', batClass = ''}: BadgesProps) {
  const badge = boostBadge(telemetry, telemetry2, status);
  const aero = showAero ? aeroLabel(telemetry2) : null;
  return (
    <>
      {/* 2026 cars have no DRS: the battery shows the ERS charge and lights up while overtake mode is in use */}
      {badge.label !== 'OVERTAKE' && <div className={`drs ${drsClass}${badge.on ? ' on' : ''}`}>{badge.label}</div>}
      {status && <Battery status={status} badge={badge} telemetry2={telemetry2} sessionType={sessionType} className={batClass} />}
      {aero && <div className={`drs aero${aero === 'STRAIGHT' ? ' on' : ''}`}>{aero}</div>}
    </>
  );
}

export const gearText = (gear: number) => (gear === 0 ? 'N' : gear < 0 ? 'R' : String(gear));

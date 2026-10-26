// Fuel and ERS meters, and the tyre compound badge.
import {ERS_MAX, compoundOf, ersModeName} from '@shared';
import type {CarStatus} from '@shared';

const pct = (v: number) => Math.max(0, Math.min(100, v)) + '%';

/** ERS mode label, with the 2026 harvest limit per lap when the game sends one. */
export const ersModeText = (st: CarStatus, format: number | undefined) =>
  ersModeName(st.m_ersDeployMode, format) +
  (st.m_ersHarvestedLimitPerLap && st.m_ersHarvestedLimitPerLap > 0 ? ` · ${(st.m_ersHarvestedLimitPerLap / 1e6).toFixed(1)} MJ/lap` : '');

const fuelLapsText = (laps: number | null | undefined) => (laps == null ? '' : `${laps >= 0 ? '+' : ''}${laps.toFixed(2)} laps`);

export function Meters({status, format}: {status: CarStatus | null | undefined; format: number | undefined}) {
  const fuelPct = status && status.m_fuelCapacity ? (status.m_fuelInTank / status.m_fuelCapacity) * 100 : 0;
  const ersPct = status ? (status.m_ersStoreEnergy / ERS_MAX) * 100 : 0;
  return (
    <div className="meters">
      <div className="meter">
        <div className="mhead">
          <span>FUEL</span>
          <b className="fueltxt">{status ? status.m_fuelInTank.toFixed(1) + ' KG' : '–'}</b>
          <small className="fuellaps">{status ? fuelLapsText(status.m_fuelRemainingLaps) : ''}</small>
        </div>
        <div className="seg">
          <i className="fuel" style={{width: pct(fuelPct)}} />
        </div>
      </div>
      <div className="meter">
        <div className="mhead">
          <span>ERS</span>
          <b className="erstxt">{status ? Math.round(ersPct) + '%' : '–'}</b>
          <small className="ersmode">{status ? ersModeText(status, format) : ''}</small>
        </div>
        <div className="seg">
          <i className="ers" style={{width: pct(ersPct)}} />
        </div>
      </div>
    </div>
  );
}

export function Compound({status, className = 'compound'}: {status: CarStatus | null | undefined; className?: string}) {
  const [name, color] = compoundOf(status?.m_visualTyreCompound);
  return (
    <span className={className}>
      <span className="cdot" style={{borderColor: status ? color : undefined}} />
      <b className="cname">{name}</b>
      <small className="cage">{status ? status.m_tyresAgeLaps + (status.m_tyresAgeLaps === 1 ? ' lap' : ' laps') : ''}</small>
    </span>
  );
}

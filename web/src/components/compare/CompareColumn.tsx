// One compared driver: live readouts, gaps and laps (the faster laps among the compared drivers in purple),
// strategy, and the same car diagram, meters and damage tiles as the dashboard.
import {memo} from 'react';
import {SLOT_COLORS, fmtTime, gapOk, leaderGap} from '@shared';
import type {CarDetail, Rival} from '@shared';
import {toggleCompared} from '../../store/ui';
import {Badges, gearText} from '../car/Badges';
import {CarDiagram} from '../car/CarDiagram';
import {DamageTiles} from '../car/DamageTiles';
import {Compound, Meters} from '../car/Meters';
import {StrategyLine} from '../car/StrategyLine';

interface Props {
  idx: number;
  slot: number;
  rival: Rival | undefined;
  detail: CarDetail | undefined;
  /** The first compared driver, the others' deltas are against. */
  reference: Rival | undefined;
  bestLast: number;
  bestBest: number;
  sessionType: number | undefined;
  format: number | undefined;
}

function VsReference({rival, reference, isReference}: {rival: Rival; reference: Rival | undefined; isReference: boolean}) {
  if (isReference || !reference) {
    return (
      <div>
        <dt className="ccvsl">REFERENCE</dt>
        <dd className="ccvs">—</dd>
      </div>
    );
  }
  const a = leaderGap(rival),
    b = leaderGap(reference);
  const delta = a == null || b == null ? null : a - b;
  return (
    <div>
      <dt className="ccvsl">VS {reference.name.slice(0, 10).toUpperCase()}</dt>
      <dd className={`ccvs${delta == null ? '' : delta > 0 ? ' behind' : ' ahead'}`}>
        {delta == null ? '–' : (delta >= 0 ? '+' : '−') + Math.abs(delta / 1000).toFixed(3)}
      </dd>
    </div>
  );
}

export const CompareColumn = memo(function CompareColumn({idx, slot, rival: r, detail: d, reference, bestLast, bestBest, sessionType, format}: Props) {
  const t = d?.telemetry;
  const restricted = !!(t && r && !r.telemetryPublic && !r.player && !t.m_speed && !t.m_engineRPM);
  const note = !t ? "Waiting for this car's data…" : restricted ? 'Telemetry restricted by this player — the game sends empty values.' : null;
  const pct = (v: number) => Math.round(v * 100) + '%';
  return (
    <div className="cc" style={{'--slot': SLOT_COLORS[slot]} as React.CSSProperties}>
      <div className="cchead">
        <i className="ccslot" />
        <span className="ccteam" style={{background: r?.color}} />
        <span className="ccpos">
          P<b>{r?.pos ?? '–'}</b>
        </span>
        <div className="ccwho">
          <b className="ccname">{r?.name ?? '–'}</b>
          <small className="ccsub">{r ? `#${r.num}${r.team ? ' · ' + r.team : ''}${r.pit ? ' · IN PIT' : ''}` : ''}</small>
        </div>
        <button className="ccx" title="Remove from comparison" aria-label="Remove from comparison" onClick={() => toggleCompared(idx)}>
          ✕
        </button>
      </div>
      {note && <div className="ccnote">{note}</div>}
      <div className="ccspeed">
        <div>
          <div className="lbl">GEAR</div>
          <b className="ccgear">{t ? gearText(t.m_gear) : 'N'}</b>
        </div>
        <div className="big">
          <b className="ccspd">{t ? t.m_speed : 0}</b>
          <div className="lbl">KM/H</div>
        </div>
        <div>
          <div className="lbl">RPM</div>
          <b className="ccrpm">{t ? t.m_engineRPM : 0}</b>
          <Badges telemetry={t} telemetry2={d?.telemetry2} status={d?.status} sessionType={sessionType} showAero={false} drsClass="ccdrs" batClass="ccbat" />
        </div>
      </div>
      <div className="ccpedals">
        <div className="hb">
          <span>THR</span>
          <div className="hbar">
            <i className="thr" style={{width: pct(t?.m_throttle || 0)}} />
          </div>
          <b className="ccthrv">{pct(t?.m_throttle || 0)}</b>
        </div>
        <div className="hb">
          <span>BRK</span>
          <div className="hbar">
            <i className="brk" style={{width: pct(t?.m_brake || 0)}} />
          </div>
          <b className="ccbrkv">{pct(t?.m_brake || 0)}</b>
        </div>
      </div>
      <dl className="ccstats">
        <div>
          <dt>GAP TO LEADER</dt>
          <dd>{!r ? '–' : r.pos === 1 ? 'LEADER' : gapOk(r.gapLeader) && r.gapLeader ? '+' + (r.gapLeader / 1000).toFixed(3) : '–'}</dd>
        </div>
        {r ? <VsReference rival={r} reference={reference} isReference={slot === 0} /> : <div><dt className="ccvsl">VS –</dt><dd className="ccvs">–</dd></div>}
        <div>
          <dt>CURRENT</dt>
          <dd>{d?.lap ? fmtTime(d.lap.m_currentLapTimeInMS) : '–'}</dd>
        </div>
        <div>
          <dt>LAST LAP</dt>
          <dd className={`cclast${r && bestLast && r.last === bestLast ? ' purple' : ''}`}>{fmtTime(r?.last)}</dd>
        </div>
        <div>
          <dt>BEST LAP</dt>
          <dd className={`ccbest${r && bestBest && r.best === bestBest ? ' purple' : ''}`}>{fmtTime(r?.best)}</dd>
        </div>
        <div>
          <dt>LAP · STOPS</dt>
          <dd>{r ? `${r.lapNum || '–'} · ${r.stops}` : '–'}</dd>
        </div>
      </dl>
      <StrategyLine rival={r} className="ccstrat" />
      <div className="cctyrehead">
        <span className="lbl">TYRES &amp; CAR</span>
        <Compound status={d?.status} />
      </div>
      <div className="tyrebox">
        <CarDiagram telemetry={t} damage={d?.damage} />
      </div>
      <Meters status={d?.status} format={format} />
      <DamageTiles damage={d?.damage} />
    </div>
  );
});

// Rival telemetry: a floating window for the car picked in the standings. Drag it by the header, resize it from
// the right edge, bottom edge or corner; double-click the header to put it back. The server sends this car's data
// as `detail` while the window is open.
import {fmtSector, fmtTime} from '@shared';
import {useEscape} from '../../hooks/dom';
import {useFloatingRect, type Edge} from '../../hooks/useFloatingRect';
import {getServerState, useServer} from '../../store/dashboard';
import {closeDriver, openCompare, useUi} from '../../store/ui';
import {buffers} from '../../telemetry/buffers';
import {CarDiagram} from '../car/CarDiagram';
import {DamageTiles} from '../car/DamageTiles';
import {Pedals, PedalTrace, SpeedRow} from '../car/DrivingReadout';
import {Compound, Meters} from '../car/Meters';
import {StrategyLine} from '../car/StrategyLine';

const EDGES: Edge[] = ['r', 'b', 'br'];
const rivalTrail = () => buffers.rivalPedals;

function DriverWindow({idx}: {idx: number}) {
  const {rect, drag, reset} = useFloatingRect();
  useEscape(closeDriver);
  const {rival, detail, session} = useServer(s => ({
    rival: s?.rivals?.find(r => r.idx === idx),
    detail: s?.detail && s.detail.idx === idx ? s.detail : undefined,
    session: s?.session,
  }));
  const t = detail?.telemetry;
  const l = detail?.lap;
  // the game sends zeros for players whose telemetry is set to Restricted
  const restricted = !!(t && rival && !rival.telemetryPublic && !rival.player && !t.m_speed && !t.m_engineRPM);
  const note = !t ? "Waiting for this car's data…" : restricted ? "This driver's telemetry is set to Restricted, so the game sends empty values for them." : null;

  const onHeadDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('button')) return;
    drag(e, null);
  };
  return (
    <div className="dm">
      <div className="dmbox" role="dialog" aria-label="Driver telemetry" style={{left: rect.x, top: rect.y, width: rect.w, height: rect.h}}>
        {EDGES.map(edge => (
          <i key={edge} className={`rz rz-${edge}`} data-edge={edge} onPointerDown={e => drag(e, edge)} />
        ))}
        <div className="dmhead" onPointerDown={onHeadDown} onDoubleClick={e => !(e.target as Element).closest('button') && reset()}>
          <span className="dmbar" style={{background: rival?.color}} />
          <span className="dmpos">
            P<b>{rival?.pos ?? '–'}</b>
          </span>
          <div className="dmwho">
            <b className="dmname">{rival?.name ?? '–'}</b>
            <small className="dmteam">{rival ? `#${rival.num}${rival.team ? ' · ' + rival.team : ''}` : ''}</small>
          </div>
          <button className="hbtn accent" title="Add this driver to the comparison" onClick={() => openCompare(getServerState()?.rivals, idx)}>
            ⇄ Compare
          </button>
          <button className="dmclose" aria-label="Close" onClick={closeDriver}>
            ✕
          </button>
        </div>
        {note && <div className="dmnote">{note}</div>}
        <StrategyLine rival={rival} />
        <div className="dmgrid">
          <div className="dmcol">
            <SpeedRow telemetry={t} telemetry2={detail?.telemetry2} status={detail?.status} sessionType={session?.sessionType} rowClass="dmspeed" />
            <Pedals telemetry={t} />
            <PedalTrace trail={rivalTrail} />
            <div className="dmlap">
              <div>
                <div className="lbl">CURRENT</div>
                <b>{l ? fmtTime(l.m_currentLapTimeInMS) : '–'}</b>
              </div>
              <div>
                <div className="lbl">LAST</div>
                <b>{l ? fmtTime(l.m_lastLapTimeInMS) : '–'}</b>
              </div>
              <div>
                <div className="lbl">LAP</div>
                <b className="dmlapnum">{rival ? rival.lapNum + (session?.totalLaps ? ' / ' + session.totalLaps : '') : '–'}</b>
              </div>
              <div>
                <div className="lbl">S1</div>
                <b>{l ? fmtSector(l.m_sector1TimeInMS ?? l.m_sector1TimeMSPart) : '–'}</b>
              </div>
              <div>
                <div className="lbl">S2</div>
                <b>{l ? fmtSector(l.m_sector2TimeInMS ?? l.m_sector2TimeMSPart) : '–'}</b>
              </div>
              <div>
                <div className="lbl">STOPS</div>
                <b>{rival?.stops ?? '–'}</b>
              </div>
            </div>
          </div>
          <div className="dmcol">
            <Compound status={detail?.status} className="compound big" />
            <div className="tyrebox">
              <CarDiagram telemetry={t} damage={detail?.damage} />
            </div>
            <Meters status={detail?.status} format={session?.packetFormat} />
            <DamageTiles damage={detail?.damage} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The rival window, while a car is selected. */
export function DriverPopup() {
  const selected = useUi(s => s.selected);
  return selected == null ? null : <DriverWindow key={selected} idx={selected} />;
}

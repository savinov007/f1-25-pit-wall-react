// Position, lap count, current / last / best lap and sectors, with lap invalid, pit and wrong-way flags.
import {memo} from 'react';
import {fmtSector, fmtTime} from '@shared';
import {useDashboard, useServer} from '../../store/dashboard';

export const LapPanel = memo(function LapPanel() {
  const {lap: l, totalLaps, reactionTime, wrongWay} = useServer(s => ({
    lap: s?.lap,
    totalLaps: s?.session?.totalLaps,
    reactionTime: s?.session?.reactionTime,
    wrongWay: !!s?.telemetry2?.m_drivingWrongWay,
  }));
  const bestLap = useDashboard(d => d.bestLap);
  const s1 = l ? l.m_sector1TimeInMS ?? l.m_sector1TimeMSPart : undefined;
  const s2 = l ? l.m_sector2TimeInMS ?? l.m_sector2TimeMSPart : undefined;
  const s3 = l && l.m_sector === 2 ? fmtSector(l.m_currentLapTimeInMS - (s1 || 0) - (s2 || 0)) : '–';
  const sectors = [fmtSector(s1), fmtSector(s2), s3];
  return (
    <>
      <h2>
        <span>Lap timing</span>
        <span className="flags">
          {!!l?.m_currentLapInvalid && <span className="flag lapinvalid">LAP INVALID</span>}
          {!!l?.m_pitStatus && <span className="flag blue inpit">IN PIT</span>}
          {l && wrongWay && <span className="flag wrongway">WRONG WAY</span>}
        </span>
      </h2>
      <div className="lapinfo">
        <div className="posbox">
          <span>P</span>
          <b className="pos">{l?.m_carPosition || '–'}</b>
        </div>
        <div className="lapcount">
          <span className="lbl">LAP</span>
          <b>
            <span className="lapnum">{l?.m_currentLapNum || '–'}</span>
            <small>
              /<span className="totallaps">{totalLaps || '–'}</span>
            </small>
          </b>
          {!!reactionTime && reactionTime > 0 && <small className="reaction">REACTION {reactionTime.toFixed(3)}s</small>}
        </div>
      </div>
      <div className="curbox">
        <div className="lbl">CURRENT LAP</div>
        <div className="cur">{l ? fmtTime(l.m_currentLapTimeInMS) : '0:00.000'}</div>
      </div>
      <div className="times">
        <div>
          <div className="lbl">LAST</div>
          <div className="last">{l ? fmtTime(l.m_lastLapTimeInMS) : '–'}</div>
        </div>
        <div className="bestbox">
          <div className="lbl">BEST</div>
          <div className="best purple">{fmtTime(bestLap)}</div>
        </div>
      </div>
      <div className="sectors">
        {sectors.map((text, i) => (
          <div key={i} className={`s${i + 1}${l && l.m_sector === i ? ' active' : ''}`}>
            <span>S{i + 1}</span>
            <b>{text}</b>
          </div>
        ))}
      </div>
    </>
  );
});

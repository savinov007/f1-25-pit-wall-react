// The field in position order: gap (interval or to the leader, or the delta to the fastest lap in BEST mode),
// last or best lap, tyre, and tags for pit, lap type, overtake mode, wrong way and penalties.
// Each row gets only text and numbers, so React skips the rows whose values did not change.
import {memo} from 'react';
import {compoundOf, fmtGap, fmtTime, lapTag} from '@shared';
import type {Rival} from '@shared';
import {getServerState, useServer} from '../../store/dashboard';
import {openCompare, openDriver, toggleGapMode, toggleLapMode, useUi, type GapMode, type LapMode} from '../../store/ui';

interface RowProps {
  idx: number;
  pos: number;
  name: string;
  team: string;
  color: string;
  /** Race number for human players with restricted telemetry (their name is often just "Player"). */
  number: number | null;
  pit: boolean;
  /** The game's driver status, for the flying / out lap tag. */
  driverStatus: number | null;
  overtake: boolean;
  wrongWay: boolean;
  penalty: number;
  gap: string;
  lap: string;
  fastest: boolean;
  compound: string;
  compoundColor: string;
  age: number;
  me: boolean;
  out: boolean;
}

const LapTag = ({driverStatus}: {driverStatus: number | null}) => {
  const t = lapTag(driverStatus);
  return t ? (
    <span className={`tag ${t.cls}`} title={t.title}>
      {t.label}
    </span>
  ) : null;
};

const StandingsRow = memo(function StandingsRow(r: RowProps) {
  const open = () => openDriver(r.idx);
  return (
    <div
      className={`srow${r.me ? ' me' : ''}${r.out ? ' out' : ''}`}
      data-idx={r.idx}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && open()}
    >
      <span className="p">{r.pos}</span>
      <span className="team" style={{background: r.color}} />
      <span className="n" title={r.team}>
        {r.name}
        {r.number != null && <small>#{r.number}</small>}
        {r.pit && <span className="tag pit">PIT</span>}
        <LapTag driverStatus={r.driverStatus} />
        {r.overtake && (
          <span className="tag ot" title="Overtake mode in use">
            OT
          </span>
        )}
        {r.wrongWay && <span className="tag ww">WRONG WAY</span>}
        {r.penalty > 0 && <span className="tag pen">+{r.penalty}s</span>}
      </span>
      <span className="g">{r.gap}</span>
      <span className={`l${r.fastest ? ' fastest' : ''}`}>{r.lap}</span>
      <span className="t">
        <i style={{borderColor: r.compoundColor}} title={r.compound} />
        {r.age}
      </span>
    </div>
  );
});

function rowProps(r: Rival, gapMode: GapMode, lapMode: LapMode, fastest: number): RowProps {
  const out = r.result > 3; // finished is 3; 4+ = DNF / DSQ / retired
  const best = lapMode === 'best';
  const gapText = out
    ? 'OUT'
    : best
    ? !r.best || !fastest
      ? '–'
      : r.best === fastest
      ? 'FASTEST'
      : '+' + ((r.best - fastest) / 1000).toFixed(3)
    : fmtGap(gapMode === 'interval' ? r.gapFront : r.gapLeader, r.pos === 1);
  const [compound, compoundColor] = compoundOf(r.compound);
  return {
    idx: r.idx,
    pos: r.pos,
    name: r.name,
    team: r.team,
    color: r.color,
    number: r.human && !r.telemetryPublic ? r.num : null,
    pit: !!r.pit,
    driverStatus: r.driverStatus ?? null,
    overtake: !!r.overtake,
    wrongWay: !!r.wrongWay,
    penalty: r.penalty || 0,
    gap: gapText,
    lap: fmtTime(best ? r.best : r.last),
    fastest: best && !!r.best && r.best === fastest,
    compound,
    compoundColor,
    age: r.age,
    me: r.player,
    out,
  };
}

export const StandingsPanel = memo(function StandingsPanel() {
  const rivals = useServer(s => s?.rivals);
  const gapMode = useUi(s => s.gapMode);
  const lapMode = useUi(s => s.lapMode);
  const bests = (rivals || []).map(r => r.best).filter(b => b > 0);
  const fastest = bests.length ? Math.min(...bests) : 0;
  const best = lapMode === 'best';
  return (
    <>
      <h2>
        <span>Standings</span>
        <span className="hbtns">
          <button className="mode comparebtn2" title="Compare drivers side by side" onClick={() => openCompare(getServerState()?.rivals)}>
            COMPARE
          </button>
          <button
            className="mode gapmode"
            disabled={best}
            // in BEST mode the gap column is the delta to the fastest lap, so interval/leader doesn't apply
            title={best ? 'Gap shows the delta to the fastest lap while BEST is selected' : 'Toggle gap type'}
            onClick={toggleGapMode}
          >
            {gapMode.toUpperCase()}
          </button>
        </span>
      </h2>
      <div className="shead">
        <span>P</span>
        <span />
        <span>DRIVER</span>
        <span className="gaphead">{best ? 'Δ BEST' : 'GAP'}</span>
        <button className="lapmode" title="Toggle last / best lap" onClick={toggleLapMode}>
          {lapMode.toUpperCase()}
        </button>
        <span>TYRE</span>
      </div>
      <div className="rows">
        {rivals?.length ? (
          rivals.map(r => <StandingsRow key={r.idx} {...rowProps(r, gapMode, lapMode, fastest)} />)
        ) : (
          <div className="empty">No rivals yet</div>
        )}
      </div>
    </>
  );
});

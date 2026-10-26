// Strategy for your car from the server's measured rates: tyre life to the chosen wear limit, pit window and
// rejoin estimate, pace trend, and how the gaps to the cars ahead and behind are moving.
import {memo} from 'react';
import {battleTrend, compoundOf, fmtLaps, fmtRate, fmtS, fmtTime, gapOk, lapsColor, nameOf, rejoinEstimate, tyreProjection} from '@shared';
import type {CarStrategy, DashboardState, Rival} from '@shared';
import {useServer} from '../../store/dashboard';
import {WEAR_LIMITS, setWearLimit, useUi} from '../../store/ui';

function TyreBlock({me, st, wearLimit}: {me: Rival; st: CarStrategy | null | undefined; wearLimit: number}) {
  const tp = tyreProjection(st, wearLimit);
  const [cname] = compoundOf(me.compound);
  const w = tp?.worst;
  return (
    <div className="sblk">
      <div className="shd">
        <span className="lbl">Tyres</span>
        <small>
          {cname} · {me.age} laps old
        </small>
      </div>
      {tp && w ? (
        <>
          <div className="shero">
            <b style={{color: lapsColor(w.left)}}>{fmtLaps(w.left)}</b>
            <span>
              laps until <em>{w.n}</em> hits {wearLimit}%<br />
              <small>{w.left === 0 ? 'already past the limit' : isFinite(w.left as number) ? `box ≈ L${me.lapNum + Math.floor(w.left as number)}` : 'not wearing yet'}</small>
            </span>
          </div>
          <div className="scorners">
            {tp.corners.map(c => (
              <div key={c.n}>
                <span>{c.n}</span>
                <b style={{color: lapsColor(c.left)}}>{fmtLaps(c.left)}</b>
                <small>{c.rate == null ? '–' : c.rate.toFixed(2) + '%/lap'}</small>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="swait">Measuring wear rate — needs about a lap on this set of tyres</div>
      )}
    </div>
  );
}

function PitBlock({s, me}: {s: DashboardState; me: Rival}) {
  const se = s.session;
  const rj = rejoinEstimate(s, me);
  const fuel = s.status?.m_fuelRemainingLaps;
  const fuelColor = fuel == null ? undefined : fuel < 0 ? 'var(--red-hi)' : fuel < 0.5 ? 'var(--amber)' : 'var(--text)';
  return (
    <div className="sblk">
      <div className="shd">
        <span className="lbl">Pit</span>
      </div>
      {!!se && se.pitIdealLap > 0 && (
        <div className="sline">
          <span>Game pit window</span>
          <b>
            L{se.pitIdealLap}
            {se.pitLatestLap > 0 ? ' – L' + se.pitLatestLap : ''}
          </b>
        </div>
      )}
      {!!se && se.pitRejoinPos > 0 && (
        <div className="sline">
          <span>Game rejoin estimate</span>
          <b>P{se.pitRejoinPos}</b>
        </div>
      )}
      {s.pitLoss ? (
        <div className="sline">
          <span>Pit loss · measured</span>
          <b>{fmtS(s.pitLoss.ms)}s</b>
          <small>
            {s.pitLoss.samples} stop{s.pitLoss.samples === 1 ? '' : 's'}
          </small>
        </div>
      ) : (
        <div className="sline">
          <span>Pit loss</span>
          <small>measured after the first stop by any car</small>
        </div>
      )}
      {rj && (
        <div className="sline hi">
          <span>Pit now →</span>
          <b>P{rj.pos}</b>
          <small>
            {[
              rj.ahead && `behind ${nameOf(rj.ahead.r)} ${fmtS(rj.after - rj.ahead.g)}s`,
              rj.behind && `ahead of ${nameOf(rj.behind.r)} ${fmtS(rj.behind.g - rj.after)}s`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </small>
        </div>
      )}
      {fuel != null && (
        <div className="sline">
          <span>Fuel margin</span>
          <b style={{color: fuelColor}}>
            {fuel >= 0 ? '+' : ''}
            {fuel.toFixed(2)} laps
          </b>
        </div>
      )}
    </div>
  );
}

function PaceBlock({st}: {st: CarStrategy | null | undefined}) {
  const p = st?.pace;
  if (!p) {
    return (
      <div className="sblk">
        <div className="shd">
          <span className="lbl">Pace</span>
        </div>
        <div className="swait">Needs a clean lap</div>
      </div>
    );
  }
  const ms = p.laps.map(l => l.ms),
    lo = Math.min(...ms),
    hi = Math.max(...ms);
  const tr = p.trendMs;
  const trendColor = tr == null ? 'var(--dim)' : tr > 50 ? 'var(--red-hi)' : tr < -50 ? 'var(--green)' : 'var(--text)';
  return (
    <div className="sblk">
      <div className="shd">
        <span className="lbl">Pace</span>
        <small>
          last {p.laps.length} clean lap{p.laps.length === 1 ? '' : 's'}
        </small>
      </div>
      <div className="space">
        <div>
          <b>{fmtTime(p.avgMs)}</b>
          <small>avg</small>
        </div>
        <div>
          <b style={{color: trendColor}}>{tr == null ? '–' : fmtRate(tr)}</b>
          <small>per lap {tr == null ? '(3+ laps)' : tr > 0 ? 'slower' : 'faster'}</small>
        </div>
        <div className="sbars">
          {p.laps.map(l => (
            <i key={l.lap} style={{height: (hi > lo ? 25 + ((l.ms - lo) / (hi - lo)) * 75 : 60) + '%'}} title={`L${l.lap} ${fmtTime(l.ms)}`} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Threat({label, other, gapMs, rateMs, chasing}: {label: string; other: Rival | undefined; gapMs: number | undefined; rateMs: number | null; chasing: boolean}) {
  if (!other) {
    return (
      <div className="sthreat">
        <span className="dir">{label}</span>
        <span className="none">{chasing ? 'Leading' : 'Nobody behind'}</span>
      </div>
    );
  }
  const trend = battleTrend(gapMs || 0, rateMs, chasing);
  const gap = gapOk(gapMs) && gapMs ? (chasing ? '+' : '−') + fmtS(gapMs) + 's' : '–';
  return (
    <div className="sthreat">
      <span className="dir">{label}</span>
      <i style={{background: other.color}} />
      <b>{nameOf(other)}</b>
      <span className="sgap">{gap}</span>
      <span className={`strend ${trend.cls}`}>{trend.text}</span>
    </div>
  );
}

function BattlesBlock({rivals, me}: {rivals: Rival[]; me: Rival}) {
  const st = me.strategy;
  const ahead = rivals.find(r => r.pos === me.pos - 1),
    behind = rivals.find(r => r.pos === me.pos + 1);
  const aheadRate = st?.gapTrend && ahead && st.gapTrend.aheadIdx === ahead.idx ? st.gapTrend.rateMs : null;
  const bt = behind?.strategy?.gapTrend;
  const behindRate = bt && bt.aheadIdx === me.idx ? bt.rateMs : null;
  return (
    <div className="sblk">
      <div className="shd">
        <span className="lbl">Battles</span>
        <small>gap trend per lap</small>
      </div>
      <Threat label="AHEAD" other={ahead} gapMs={me.gapFront} rateMs={aheadRate} chasing />
      <Threat label="BEHIND" other={behind} gapMs={behind?.gapFront} rateMs={behindRate} chasing={false} />
    </div>
  );
}

export const StrategyPanel = memo(function StrategyPanel() {
  const s = useServer((s): DashboardState | null =>
    s && {connected: s.connected, hasData: s.hasData, pps: s.pps, rivals: s.rivals, session: s.session, pitLoss: s.pitLoss, status: s.status}
  );
  const wearLimit = useUi(u => u.wearLimit);
  const me = s?.rivals?.find(r => r.player);
  return (
    <>
      <h2>
        <span>Strategy</span>
        <label className="wearlimit" title="Wear level you plan to pit at">
          PIT AT
          <select value={wearLimit} onChange={e => setWearLimit(Number(e.target.value))} aria-label="Wear limit">
            {WEAR_LIMITS.map(v => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          %
        </label>
      </h2>
      <div className="strat">
        {s && me ? (
          <>
            <TyreBlock me={me} st={me.strategy} wearLimit={wearLimit} />
            <PitBlock s={s} me={me} />
            <PaceBlock st={me.strategy} />
            <BattlesBlock rivals={s.rivals || []} me={me} />
          </>
        ) : (
          <div className="empty">Waiting for data</div>
        )}
      </div>
    </>
  );
});

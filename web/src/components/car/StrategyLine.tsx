// One-line strategy summary for any driver (compare columns, rival popup): laps to the wear limit and pace trend.
import {fmtLaps, fmtRate, lapsColor, tyreProjection} from '@shared';
import type {Rival} from '@shared';
import {useUi} from '../../store/ui';

export function StrategyLine({rival, className = ''}: {rival: Rival | undefined; className?: string}) {
  const wearLimit = useUi(s => s.wearLimit);
  const st = rival?.strategy;
  const tp = tyreProjection(st, wearLimit);
  const w = tp?.worst;
  const trend = st?.pace?.trendMs;
  return (
    <div className={`stratline ${className}`}>
      <span className="lbl">Strategy</span>{' '}
      {w ? (
        <>
          <b style={{color: lapsColor(w.left)}}>{fmtLaps(w.left)} laps</b> to {wearLimit}%{' '}
          <small>
            ({w.n} {w.rate == null ? '' : w.rate.toFixed(2) + '%/lap'})
          </small>
        </>
      ) : (
        <small>wear rate: measuring…</small>
      )}
      {trend != null && (
        <>
          {' · '}pace <b>{fmtRate(trend)}</b>
          <small>/lap</small>
        </>
      )}
    </div>
  );
}

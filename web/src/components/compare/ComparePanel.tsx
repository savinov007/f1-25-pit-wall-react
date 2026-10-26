// Compare mode: up to four drivers side by side under one overlaid trace chart. The server sends the compared
// cars' data as `compare` while it is open.
import {SLOT_COLORS} from '@shared';
import {useEscape} from '../../hooks/dom';
import {useServer} from '../../store/dashboard';
import {MAX_COMPARE, closeCompare, toggleCompared, useUi} from '../../store/ui';
import {CompareChart} from './CompareChart';
import {CompareColumn} from './CompareColumn';

function Picker({selected}: {selected: number[]}) {
  const rivals = useServer(s => s?.rivals) || [];
  return (
    <div className="cmppick">
      {rivals.length ? (
        rivals.map(r => {
          const slot = selected.indexOf(r.idx);
          return (
            <button
              key={r.idx}
              className={`pchip${slot >= 0 ? ' on' : ''}`}
              data-idx={r.idx}
              disabled={slot < 0 && selected.length >= MAX_COMPARE}
              style={{'--team': r.color, ...(slot >= 0 ? {'--slot': SLOT_COLORS[slot]} : {})} as React.CSSProperties}
              onClick={() => toggleCompared(r.idx)}
            >
              <i />
              <b>{r.pos}</b>
              {r.name.slice(0, 14)}
              {r.player && (
                <>
                  {' '}
                  <em>YOU</em>
                </>
              )}
            </button>
          );
        })
      ) : (
        <span className="lbl">No drivers yet</span>
      )}
    </div>
  );
}

/** Best values across the compared drivers get highlighted; with fewer than two laps there is nothing to compare. */
const minOf = (vals: (number | undefined)[]) => {
  const v = vals.filter((x): x is number => !!x && x > 0);
  return v.length > 1 ? Math.min(...v) : 0;
};

function Columns({selected}: {selected: number[]}) {
  const {rivals, compare, sessionType, format} = useServer(s => ({
    rivals: s?.rivals,
    compare: s?.compare,
    sessionType: s?.session?.sessionType,
    format: s?.session?.packetFormat,
  }));
  if (!selected.length) {
    return (
      <div className="cmpcols">
        <div className="cmpempty">Pick drivers above to compare their telemetry</div>
      </div>
    );
  }
  const byIdx = new Map((rivals || []).map(r => [r.idx, r]));
  const details = new Map((compare || []).map(d => [d.idx, d]));
  const sel = selected.map(i => byIdx.get(i));
  const bestLast = minOf(sel.map(r => r?.last)),
    bestBest = minOf(sel.map(r => r?.best));
  return (
    <div className="cmpcols" style={{'--n': selected.length} as React.CSSProperties}>
      {selected.map((idx, k) => (
        <CompareColumn
          key={idx}
          idx={idx}
          slot={k}
          rival={byIdx.get(idx)}
          detail={details.get(idx)}
          reference={byIdx.get(selected[0])}
          bestLast={bestLast}
          bestBest={bestBest}
          sessionType={sessionType}
          format={format}
        />
      ))}
    </div>
  );
}

function CompareView() {
  const selected = useUi(s => s.compare);
  useEscape(closeCompare);
  return (
    <div className="cmp">
      <div className="cmpbar">
        <div className="cmptitle">
          <span className="stripes">
            <i />
            <i />
            <i />
          </span>
          COMPARE<small>up to 4 drivers</small>
        </div>
        <Picker selected={selected} />
        <button className="dmclose" aria-label="Close comparison" onClick={closeCompare}>
          ✕
        </button>
      </div>
      <CompareChart />
      <Columns selected={selected} />
    </div>
  );
}

export function ComparePanel() {
  const open = useUi(s => s.compareOpen);
  return open ? <CompareView /> : null;
}

// The overlaid trace chart in compare mode, with its axis / window / lap / metric toggles.
import {useRef} from 'react';
import type {Metric} from '@shared';
import {drawCompareChart} from '../../charts/compareChart';
import {useCanvasFrame} from '../../hooks/useCanvasFrame';
import {getServerState} from '../../store/dashboard';
import {COMPARE_WINDOWS, setAxis, setLapView, setMetric, setWindow, useUi, type ChartAxis, type LapView} from '../../store/ui';
import {buffers} from '../../telemetry/buffers';

interface TabsProps<T extends string | number> {
  /** data-* attribute for each button, so the options are easy to find. */
  attr: string;
  options: [T, string][];
  value: T;
  onChange: (v: T) => void;
  title?: string;
  className: string;
}
function Tabs<T extends string | number>({attr, options, value, onChange, title, className}: TabsProps<T>) {
  return (
    <div className={`tabs ${className}`} title={title}>
      {options.map(([v, label]) => (
        <button key={v} {...{[`data-${attr}`]: v}} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

const AXES: [ChartAxis, string][] = [['time', 'LIVE TIME'], ['dist', 'LAP DISTANCE']];
const WINDOWS: [number, string][] = COMPARE_WINDOWS.map(w => [w, w < 60 ? `${w} S` : `${w / 60} MIN`]);
const LAPS: [LapView, string][] = [['cur', 'CURRENT LAP'], ['last', 'LAST LAP'], ['best', 'BEST LAP']];
const METRICS: [Metric, string][] = [
  ['speed', 'SPEED'], ['thr', 'THROTTLE'], ['brk', 'BRAKE'], ['gear', 'GEAR'], ['ers', 'BATTERY'], ['mode', 'ERS MODE'],
];
const fmtWindow = (sec: number) => (sec < 60 ? `${sec} s` : `${sec / 60} min`);

export function CompareChart() {
  const axis = useUi(s => s.axis);
  const window = useUi(s => s.window);
  const lapView = useUi(s => s.lapView);
  const metric = useUi(s => s.metric);
  const hoverX = useRef<number | null>(null);

  const ref = useCanvasFrame((ctx, w, h, now) => {
    const ui = useUi.getState();
    const s = getServerState();
    const rivals = s?.rivals || [];
    drawCompareChart(ctx, w, h, {
      slots: ui.compare.map(idx => ({
        name: rivals.find(r => r.idx === idx)?.name || '—',
        trail: buffers.trails.get(idx),
        laps: buffers.laps.get(idx),
      })),
      metric: ui.metric,
      axis: ui.axis,
      lapView: ui.lapView,
      window: ui.window,
      trackLength: s?.session?.trackLength,
      format: s?.session?.packetFormat,
      hoverX: hoverX.current,
      now,
    });
  });

  return (
    <div className="cmpchart">
      <div className="cmpchead">
        <span className="lbl cmpchartlbl">{axis === 'dist' ? 'Lap-synced trace · by distance' : `Live trace · last ${fmtWindow(window)}`}</span>
        <div className="cmpctrls">
          <Tabs className="cmpaxis" attr="a" options={AXES} value={axis} onChange={setAxis} title="Plot against time, or against distance around the lap so corners line up" />
          {axis === 'time' && <Tabs className="cmpwin" attr="w" options={WINDOWS} value={window} onChange={setWindow} title="How far back the live trace goes" />}
          {axis === 'dist' && <Tabs className="cmplap" attr="l" options={LAPS} value={lapView} onChange={setLapView} />}
          <Tabs className="cmpmetric" attr="m" options={METRICS} value={metric} onChange={setMetric} />
        </div>
      </div>
      <canvas
        ref={ref}
        className="cmpcanvas"
        onPointerMove={e => (hoverX.current = e.nativeEvent.offsetX)}
        onPointerLeave={() => (hoverX.current = null)}
      />
    </div>
  );
}

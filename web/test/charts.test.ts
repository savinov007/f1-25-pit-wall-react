// Canvas drawing as pure functions: called with a fake 2D context that logs every call.
import {describe, expect, test} from 'vitest';
import type {DistPoint, LapTraces, TimePoint} from '@shared';
import {drawCompareChart, type CompareChartInput} from '../src/charts/compareChart';
import {drawPedalTrace} from '../src/charts/pedalTrace';
import {AERO_ZONE_COLOR, DRS_ZONE_COLOR, drawTrackMap} from '../src/charts/trackMap';
import {buffers, ingest, resetBuffers} from '../src/telemetry/buffers';
import {dashboardState, demoRivals, fakeContext} from './helpers';

const strokes = (log: unknown[][]) => log.filter(c => c[0] === 'set' && c[1] === 'strokeStyle').map(c => c[2]);

describe('track map', () => {
  test('learns the circuit from every car and draws rivals with labels', () => {
    resetBuffers();
    const s = dashboardState();
    ingest(s, {selected: null, compareOpen: false}, 0);
    const {ctx, labels} = fakeContext();
    drawTrackMap(ctx, 400, 300, {track: buffers.track, rivals: s.rivals!, car: buffers.car, session: s.session});
    expect(labels()).toContain('VER');
    expect(labels()).toContain('NOR');
    expect(labels(), 'your car is the white dot, not a label').not.toContain('YOU');
  });
  test('waits for cars before there is anything to draw', () => {
    const {ctx, labels} = fakeContext();
    drawTrackMap(ctx, 400, 300, {track: new Map(), rivals: [], car: null, session: null});
    expect(labels()).toEqual(['WAITING FOR CARS ON TRACK']);
  });
  test('draws active aero and DRS zones', () => {
    resetBuffers();
    const s = dashboardState();
    // a full lap of the demo field, so the outline covers both zones
    for (let t = 0; t < 30000; t += 100) ingest({...s, rivals: demoRivals(t, 1)}, {selected: null, compareOpen: false}, t);
    let f = fakeContext();
    drawTrackMap(f.ctx, 400, 300, {track: buffers.track, rivals: s.rivals!, car: null, session: s.session});
    expect(strokes(f.log)).toContain(AERO_ZONE_COLOR);
    expect(strokes(f.log)).toContain(DRS_ZONE_COLOR);
    f = fakeContext();
    drawTrackMap(f.ctx, 400, 300, {track: buffers.track, rivals: s.rivals!, car: null, session: {...s.session!, aeroZones: [], drsZones: []}});
    expect(strokes(f.log)).not.toContain(AERO_ZONE_COLOR);
    expect(strokes(f.log)).not.toContain(DRS_ZONE_COLOR);
  });
});

describe('pedal trace', () => {
  test('draws throttle and brake, nothing from a single sample', () => {
    let f = fakeContext();
    drawPedalTrace(f.ctx, 300, 100, [{t: 0, thr: 1, brk: 0}], 0);
    expect(f.log.filter(c => c[0] === 'fill').length).toBe(0);
    f = fakeContext();
    drawPedalTrace(f.ctx, 300, 100, [{t: 0, thr: 1, brk: 0}, {t: 50, thr: 0.5, brk: 0.2}], 100);
    expect(strokes(f.log)).toContain('rgb(31, 209, 102)');
    expect(strokes(f.log)).toContain('rgb(255, 45, 31)');
  });
});

describe('compare chart', () => {
  const pt = (d: number, mode: number | null = 2, ers: number | null = 0.5): DistPoint => ({d, speed: 200, thr: 1, brk: 0, gear: 6, ers, mode});
  const laps = (lt: Partial<LapTraces>): LapTraces => ({lap: 99, cur: [], last: [], lastLap: null, best: [], bestLap: null, bestTime: 0, invalid: false, ...lt});
  const input = (o: Partial<CompareChartInput>): CompareChartInput => ({
    slots: [], metric: 'speed', axis: 'dist', lapView: 'last', window: 20, trackLength: 5000, format: 2026, hoverX: null, now: 0, ...o,
  });
  const draw = (o: Partial<CompareChartInput>) => {
    const f = fakeContext();
    drawCompareChart(f.ctx, 600, 200, input(o));
    return f;
  };
  // a step: two lineTo calls in a row at the same x (across, then straight up or down)
  const steps = (log: unknown[][]) =>
    log.filter((c, i) => i && c[0] === 'lineTo' && log[i - 1][0] === 'lineTo' && c[1] === log[i - 1][1] && c[2] !== log[i - 1][2]).length;

  test('battery and ERS mode charts', () => {
    const you = {name: 'YOU', trail: undefined, laps: laps({last: [pt(0, 1), pt(50, 1), pt(100, 3)]})};
    let f = draw({slots: [you], metric: 'ers'});
    expect(f.labels(), 'battery axis in percent').toContain('50%');
    expect(steps(f.log), 'the battery charge is a plain line').toBe(0);
    f = draw({slots: [you], metric: 'mode'});
    expect(f.labels().filter(l => ['NONE', 'MED', 'HOT', 'BOOST', 'OT'].includes(l)), 'short labels, 2026 names').toEqual(['NONE', 'MED', 'HOT', 'BOOST']);
    expect(steps(f.log), 'the deploy mode changes as a step, not a ramp').toBe(1);

    // hovering both drivers: values, but no meaningless "+1" for a category
    const nor = {name: 'NORRIS', trail: undefined, laps: laps({last: [pt(0), pt(50), pt(100)]})};
    f = draw({slots: [you, nor], metric: 'mode', hoverX: 46});
    expect(f.labels(), 'the hover readout names the mode').toContain('Hotlap');
    expect(f.labels().some(l => /^[+−±]\d/.test(l)), 'no delta for the deploy mode').toBe(false);
    f = draw({slots: [you, nor], metric: 'ers', hoverX: 46});
    expect(f.labels(), 'the battery does get a delta').toContain('±0%');
  });
  test('an unknown battery breaks the line instead of dropping to 0 %', () => {
    const moveTos = (log: unknown[][]) => log.filter(c => c[0] === 'moveTo').length;
    const whole = moveTos(draw({slots: [{name: 'A', trail: undefined, laps: laps({last: [pt(0), pt(20), pt(40), pt(60)]})}], metric: 'ers'}).log);
    const f = draw({slots: [{name: 'A', trail: undefined, laps: laps({last: [pt(0), pt(20, null, null), pt(40), pt(60)]})}], metric: 'ers'});
    expect(moveTos(f.log), 'one break in the line').toBe(whole + 1);
    expect(f.log.some(c => (c[0] === 'lineTo' || c[0] === 'moveTo') && Number.isNaN(c[2])), 'no NaN points').toBe(false);
  });
  test('the best lap', () => {
    let f = draw({lapView: 'best', slots: [{name: 'A', trail: undefined, laps: laps({})}]});
    expect(f.labels()).toContain('NO FULL VALID LAP RECORDED YET');
    f = draw({lapView: 'best', slots: [{name: 'A', trail: undefined, laps: laps({best: [pt(0), pt(50), pt(100)], bestLap: 3, bestTime: 90000})}]});
    expect(f.labels()).not.toContain('NO FULL VALID LAP RECORDED YET');
    expect(strokes(f.log).filter(c => c === '#ff2d1f').length, 'the best lap is drawn').toBe(1);
  });
  test('the live trace draws only the chosen window of the 3 minutes kept', () => {
    const now = 200000;
    const trail: TimePoint[] = Array.from({length: 180}, (_, i) => ({t: now - (179 - i) * 1000, speed: 200, thr: 1, brk: 0, gear: 6, ers: 0.5, mode: 2}));
    const slot = {name: 'YOU', trail, laps: undefined};
    const run = (window: number) => {
      const f = draw({axis: 'time', window, slots: [slot], now});
      // trace points left of the plot area would be drawn over the axis labels
      return {labels: f.labels(), offPlot: f.log.filter(c => c[0] === 'lineTo' && (c[1] as number) < 40).length, points: f.log.filter(c => c[0] === 'lineTo').length};
    };
    const short = run(20);
    expect(short.labels).toContain('-20s');
    expect(short.labels).not.toContain('-1:00');
    expect(short.offPlot, 'only the window is drawn').toBe(0);
    const long = run(180);
    expect(long.labels).toContain('-3:00');
    expect(long.labels).toContain('-30s');
    expect(long.points, 'the whole 3 minutes is drawn').toBeGreaterThan(short.points + 100);
  });
});

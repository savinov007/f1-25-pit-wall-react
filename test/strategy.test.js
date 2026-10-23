const {test, describe} = require('node:test');
const assert = require('node:assert/strict');
const {StrategyTracker, slope, median} = require('../strategy');

const TRACK = 5000;
const STEPS = 20; // updates per lap

// One car's lap-data entry, in the shape the parser produces.
function lapEntry(o) {
  return {
    m_resultStatus: 2, m_currentLapNum: 1, m_lapDistance: 0, m_carPosition: 1, m_numPitStops: 0, m_pitStatus: 0,
    m_currentLapInvalid: 0, m_lastLapTimeInMS: 0, m_deltaToCarInFrontMSPart: 0, m_deltaToCarInFrontMinutesPart: 0,
    ...o,
  };
}

/**
 * Drives a tracker through `laps` laps of a two-car race. car(lap, frac) returns per-update overrides for car 0
 * (the car under test, P2); car 1 leads. wear(x) gives car 0's tyre wear at x laps driven.
 */
function race(tracker, {laps, lapTime = () => 90000, wear = () => [0, 0, 0, 0], car = () => ({}), gap = () => 2000, age = () => 0}) {
  let last = 0;
  for (let lap = 1; lap <= laps; lap++) {
    for (let step = 0; step < STEPS; step++) {
      const frac = step / STEPS, x = lap - 1 + frac;
      const me = lapEntry({m_currentLapNum: lap, m_lapDistance: frac * TRACK, m_carPosition: 2, m_lastLapTimeInMS: last,
        m_deltaToCarInFrontMSPart: gap(lap), ...car(lap, frac)});
      const leader = lapEntry({m_currentLapNum: lap, m_lapDistance: frac * TRACK, m_carPosition: 1, m_lastLapTimeInMS: 89000});
      tracker.update([me, leader], [{m_tyresWear: wear(x)}, {m_tyresWear: [0, 0, 0, 0]}],
        [{m_tyresAgeLaps: age(lap, frac)}, {m_tyresAgeLaps: lap}], TRACK);
    }
    last = lapTime(lap);
  }
}

describe('helpers', () => {
  test('slope fits a least-squares line', () => {
    assert.equal(slope([{x: 0, y: 1}, {x: 1, y: 3}, {x: 2, y: 5}]), 2);
    assert.equal(slope([{x: 1, y: 1}]), null, 'needs two points');
    assert.equal(slope([{x: 1, y: 1}, {x: 1, y: 5}]), null, 'vertical line has no slope');
  });
  test('median handles odd, even and empty lists', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.equal(median([]), null);
  });
});

describe('tyre wear rate', () => {
  test('measures each corner separately from lap-end and live readings', () => {
    const t = new StrategyTracker();
    const rates = [1.5, 1.6, 2.0, 2.4];
    race(t, {laps: 4, wear: x => rates.map(r => r * x)});
    const s = t.summary(0);
    rates.forEach((r, k) => assert.ok(Math.abs(s.wearRate[k] - r) < 1e-9, `corner ${k}`));
    assert.deepEqual(s.wear, rates.map(r => r * (3 + (STEPS - 1) / STEPS)));
    assert.equal(s.stintLaps, 3);
  });
  test('needs about a lap of data before reporting a rate', () => {
    const t = new StrategyTracker();
    race(t, {laps: 1, wear: x => [x, x, x, x]});
    assert.equal(t.summary(0).wearRate, null);
  });
  test('never reports negative wear', () => {
    const t = new StrategyTracker();
    race(t, {laps: 4, wear: x => [10 - x, 0, 0, 0]});
    assert.equal(t.summary(0).wearRate[0], 0);
  });
  test('a fresh set (tyre age goes backwards) starts a new stint', () => {
    const t = new StrategyTracker();
    // stint 1 wears 5%/lap; at lap 4 the age resets and the new set wears 1%/lap
    race(t, {
      laps: 7,
      wear: x => (x < 3.5 ? [5 * x, 5 * x, 5 * x, 5 * x] : [1 * (x - 3.5), 1 * (x - 3.5), 1 * (x - 3.5), 1 * (x - 3.5)]),
      age: (lap, frac) => (lap - 1 + frac < 3.5 ? lap : lap - 4),
    });
    const s = t.summary(0);
    assert.ok(Math.abs(s.wearRate[0] - 1) < 1e-9, `rate ${s.wearRate[0]}`);
  });
});

describe('pace', () => {
  test('averages recent clean laps and fits the trend', () => {
    const t = new StrategyTracker();
    race(t, {laps: 7, lapTime: lap => 90000 + lap * 100});
    const p = t.summary(0).pace;
    assert.equal(p.trendMs, 100);
    assert.equal(p.avgMs, 90500); // median of laps 4..6
    assert.deepEqual(p.laps.map(l => l.lap), [2, 3, 4, 5, 6]);
  });
  test('drops invalid laps and pit laps', () => {
    const t = new StrategyTracker();
    race(t, {
      laps: 6,
      lapTime: () => 90000,
      car: (lap, frac) => ({m_currentLapInvalid: lap === 3 ? 1 : 0, m_pitStatus: lap === 4 && frac > 0.5 ? 1 : 0}),
    });
    assert.deepEqual(t.summary(0).pace.laps.map(l => l.lap), [1, 2, 5]);
  });
  test('ignores outliers more than 3% off the median', () => {
    const t = new StrategyTracker();
    race(t, {laps: 6, lapTime: lap => (lap === 3 ? 99000 : 90000)});
    assert.ok(!t.summary(0).pace.laps.some(l => l.lap === 3));
  });
  test('trend needs three laps', () => {
    const t = new StrategyTracker();
    race(t, {laps: 3});
    assert.equal(t.summary(0).pace.trendMs, null);
    assert.equal(t.summary(0).pace.laps.length, 2);
  });
});

describe('interval to the car ahead', () => {
  test('reports how fast the gap closes per lap', () => {
    const t = new StrategyTracker();
    race(t, {laps: 6, gap: lap => 5000 - lap * 300});
    assert.deepEqual(t.summary(0).gapTrend, {aheadIdx: 1, rateMs: -300});
  });
  test('only uses laps behind the same car', () => {
    const t = new StrategyTracker();
    const lap = (car0, car1, car2) => [car0, car1, car2];
    // car 0 runs P3 behind car 2, then passes it halfway round lap 4 and runs P2 behind car 1
    for (let n = 1; n <= 5; n++) {
      for (let s = 0; s < STEPS; s++) {
        const frac = s / STEPS;
        const behind2 = n < 4 || (n === 4 && frac < 0.5);
        t.update(lap(
          lapEntry({m_currentLapNum: n, m_lapDistance: frac * TRACK, m_carPosition: behind2 ? 3 : 2, m_deltaToCarInFrontMSPart: 1000 + n * 50}),
          lapEntry({m_currentLapNum: n, m_lapDistance: frac * TRACK, m_carPosition: 1}),
          lapEntry({m_currentLapNum: n, m_lapDistance: frac * TRACK, m_carPosition: behind2 ? 2 : 3}),
        ), null, null, TRACK);
      }
    }
    const g = t.summary(0).gapTrend;
    assert.equal(g.aheadIdx, 1);
    assert.equal(g.rateMs, null, 'one lap behind the new car is not a trend yet');
  });
  test('the leader has no gap trend', () => {
    const t = new StrategyTracker();
    race(t, {laps: 4});
    assert.equal(t.summary(1).gapTrend, null);
  });
});

describe('pit loss', () => {
  const pitRace = (inLapExtra, outLapExtra) => {
    const t = new StrategyTracker();
    race(t, {
      laps: 9,
      lapTime: lap => 90000 + lap * 100 + (lap === 5 ? inLapExtra : lap === 6 ? outLapExtra : 0),
      car: (lap, frac) => ({
        m_pitStatus: (lap === 5 && frac > 0.9) || (lap === 6 && frac < 0.1) ? 1 : 0,
        m_numPitStops: lap > 6 || (lap === 6 && frac > 0) ? 1 : 0,
      }),
    });
    return t;
  };
  test('measures the stop against the projected pace', () => {
    assert.deepEqual(pitRace(8000, 14000).pitLoss(), {ms: 22000, samples: 1});
  });
  test('rejects implausible values', () => {
    assert.equal(pitRace(1000, 1000).pitLoss(), null, 'too small to be a stop');
    assert.equal(pitRace(40000, 40000).pitLoss(), null, 'too large (red flag, retirement)');
  });
  test('is the median over several stops and resets with the tracker', () => {
    const t = new StrategyTracker();
    t.pitLosses.push(20000, 30000, 21000);
    assert.deepEqual(t.pitLoss(), {ms: 21000, samples: 3});
    t.reset();
    assert.equal(t.pitLoss(), null);
    assert.equal(t.summary(0), null);
  });
});

describe('robustness', () => {
  test('a flashback that rewinds the lap counter starts the car over', () => {
    const t = new StrategyTracker();
    race(t, {laps: 5, wear: x => [x, x, x, x]});
    t.update([lapEntry({m_currentLapNum: 2, m_carPosition: 2}), lapEntry({m_currentLapNum: 2})], null, null, TRACK);
    const s = t.summary(0);
    assert.equal(s.wearRate, null);
    assert.equal(s.pace, null);
  });
  test('inactive and missing cars are ignored', () => {
    const t = new StrategyTracker();
    t.update([lapEntry({m_resultStatus: 1}), null], null, null, TRACK);
    assert.equal(t.summary(0), null);
    assert.equal(t.summary(1), null);
    t.update(null, null, null, TRACK);
  });
  test('works without a known track length', () => {
    const t = new StrategyTracker();
    race(t, {laps: 3, wear: x => [x, x, x, x]});
    t.update([lapEntry({m_currentLapNum: 3, m_carPosition: 2, m_lapDistance: 2500}), lapEntry({m_currentLapNum: 3})],
      [{m_tyresWear: [3, 3, 3, 3]}, {m_tyresWear: [0, 0, 0, 0]}], null, 0);
    assert.ok(t.summary(0).wearRate);
  });
});

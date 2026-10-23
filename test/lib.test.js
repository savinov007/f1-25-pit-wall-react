const {test, describe} = require('node:test');
const assert = require('node:assert/strict');
const L = require('../public/lib');

describe('formatting', () => {
  test('lap times', () => {
    assert.equal(L.fmtTime(0), '–');
    assert.equal(L.fmtTime(null), '–');
    assert.equal(L.fmtTime(89123), '1:29.123');
    assert.equal(L.fmtTime(5050), '0:05.050');
    assert.equal(L.fmtTime(3723456), '62:03.456');
  });
  test('sectors, clock and seconds', () => {
    assert.equal(L.fmtSector(0), '–');
    assert.equal(L.fmtSector(32391), '32.391');
    assert.equal(L.fmtClock(0), '0:00');
    assert.equal(L.fmtClock(125), '2:05');
    assert.equal(L.fmtS(1234), '1.23');
    assert.equal(L.fmtS(21400), '21.4', 'one decimal from 10 s');
    assert.equal(L.fmtRate(120), '+0.12s');
    assert.equal(L.fmtRate(-310), '−0.31s');
  });
  test('gaps hide garage values over 10 minutes', () => {
    assert.equal(L.fmtGap(0, true), 'LEADER');
    assert.equal(L.fmtGap(1234), '+1.234');
    assert.equal(L.fmtGap(0), '–');
    assert.equal(L.fmtGap(15212108), '–');
    assert.equal(L.gapOk(0), true);
    assert.equal(L.gapOk(600000), false);
    assert.equal(L.gapOk(-1), false);
  });
  test('leader gap is null when unknown', () => {
    assert.equal(L.leaderGap({pos: 1, gapLeader: 0}), 0);
    assert.equal(L.leaderGap({pos: 3, gapLeader: 2500}), 2500);
    assert.equal(L.leaderGap({pos: 3, gapLeader: 0}), null, 'no timing yet');
    assert.equal(L.leaderGap({pos: 3, gapLeader: 9e6}), null, 'garage value');
  });
  test('escaping and capitalising', () => {
    assert.equal(L.esc('<b a="x">&</b>'), '&lt;b a=&quot;x&quot;&gt;&amp;&lt;/b&gt;');
    assert.equal(L.esc(42), '42');
    assert.equal(L.cap('fuelTxt'), 'FuelTxt');
    assert.equal(L.nameOf({name: 'verstappen-long-name'}), 'VERSTAPPEN-L');
    assert.equal(L.nameOf({name: '<x>'}), '&lt;X&gt;');
  });
  test('laps', () => {
    assert.equal(L.fmtLaps(null), '–');
    assert.equal(L.fmtLaps(Infinity), '∞');
    assert.equal(L.fmtLaps(5.26), '5.3');
    assert.equal(L.fmtLaps(12.6), '13');
  });
});

describe('colour scales', () => {
  test('tyre temperature bands', () => {
    assert.equal(L.tempColor(70), '#3aa0ff');
    assert.equal(L.tempColor(80), '#1fd166');
    assert.equal(L.tempColor(105), '#ffb020');
    assert.equal(L.tempColor(115), '#ff2d1f');
  });
  test('wear bands', () => {
    assert.equal(L.wearColor(0), '#1fd166');
    assert.equal(L.wearColor(25), '#e6d84a');
    assert.equal(L.wearColor(45), '#ffb020');
    assert.equal(L.wearColor(65), '#ff2d1f');
  });
  test('damage levels', () => {
    assert.deepEqual([0, 1, 19, 20, 49, 50, 100].map(L.dmgLevel), [0, 1, 1, 2, 2, 3, 3]);
    assert.equal(L.DMG_COLORS.length, 4);
  });
  test('laps-left colours', () => {
    assert.equal(L.lapsColor(null), 'var(--green)');
    assert.equal(L.lapsColor(Infinity), 'var(--green)');
    assert.equal(L.lapsColor(2), 'var(--red-hi)');
    assert.equal(L.lapsColor(4), 'var(--amber)');
    assert.equal(L.lapsColor(8), 'var(--green)');
  });
});

describe('constants', () => {
  test('tyre order maps visual corners to the game arrays (RL RR FL FR)', () => {
    assert.deepEqual(L.TYRES.map(t => [t.n, t.i]), [['FL', 2], ['FR', 3], ['RL', 0], ['RR', 1]]);
  });
  test('damage keys and car parts point at real packet fields', () => {
    assert.equal(L.DMG_KEYS.length, 8);
    for (const [key] of [...L.DMG_KEYS, ...L.CAR_PARTS.map(([, k]) => [k])]) assert.match(key, /^m_\w+Damage$/);
    assert.equal(L.COMPOUNDS[16][0], 'Soft');
    assert.equal(L.ERS_MODES[2], 'Hotlap');
    assert.equal(L.WEATHER[5], 'Storm');
  });
});

describe('track learning', () => {
  const car = o => ({pit: 0, result: 2, dist: 100, x: 10, z: 20, ...o});
  test('buckets positions by lap distance', () => {
    const track = L.learnTrack(new Map(), [car({}), car({dist: 108, x: 18, z: 20})]);
    assert.deepEqual([...track.keys()], [12, 13]);
    assert.deepEqual(track.get(12), {x: 10, z: 20});
  });
  test('skips pit-lane, inactive, pre-start and unplaced cars', () => {
    const track = L.learnTrack(new Map(), [car({pit: 1}), car({result: 3}), car({dist: -5}), car({x: 0, z: 0}), null].filter(Boolean));
    assert.equal(track.size, 0);
    L.learnTrack(track, undefined);
  });
  test('smooths repeated passes', () => {
    const track = L.learnTrack(new Map(), [car({x: 10})]);
    L.learnTrack(track, [car({x: 20})]);
    assert.equal(track.get(12).x, 12);
  });
  test('ignores teleports far from known neighbours', () => {
    const track = L.learnTrack(new Map(), [car({dist: 92, x: 1, z: 1})]);
    L.learnTrack(track, [car({dist: 100, x: 500, z: 500})]);
    assert.equal(track.has(12), false);
  });
});

describe('lap-synced traces', () => {
  const tel = speed => ({m_speed: speed, m_throttle: 1, m_brake: 0, m_gear: 7});
  const lap = (n, d) => ({m_currentLapNum: n, m_lapDistance: d});
  test('records samples by distance, skipping duplicates and pre-start', () => {
    const traces = new Map();
    L.recordLapTrace(traces, 3, tel(100), lap(1, -50));
    L.recordLapTrace(traces, 3, tel(100), lap(1, 0));
    L.recordLapTrace(traces, 3, tel(101), lap(1, 1));
    L.recordLapTrace(traces, 3, tel(120), lap(1, 5));
    assert.deepEqual(traces.get(3).cur.map(p => [p.d, p.speed]), [[0, 100], [5, 120]]);
  });
  test('keeps a finished lap only if it was mostly recorded', () => {
    const traces = new Map();
    for (let d = 0; d < 100; d += 2) L.recordLapTrace(traces, 0, tel(d), lap(1, d));
    L.recordLapTrace(traces, 0, tel(0), lap(2, 0));
    assert.equal(traces.get(0).lastLap, 1);
    assert.equal(traces.get(0).last.length, 50);
    L.recordLapTrace(traces, 0, tel(0), lap(3, 0));
    assert.equal(traces.get(0).lastLap, 1, 'a one-sample lap does not replace it');
  });
  test('a flashback drops the undone part of the lap', () => {
    const traces = new Map();
    for (const d of [0, 100, 200, 300]) L.recordLapTrace(traces, 0, tel(d), lap(1, d));
    L.recordLapTrace(traces, 0, tel(150), lap(1, 150));
    assert.deepEqual(traces.get(0).cur.map(p => p.d), [0, 100, 150], 'resumes from the rewound point');
  });
});

describe('chart helpers', () => {
  const pts = [0, 10, 20, 30].map(d => ({d}));
  test('nearest sample by binary search', () => {
    assert.equal(L.nearest([], 'd', 5), null);
    assert.equal(L.nearest(pts, 'd', 14).d, 10);
    assert.equal(L.nearest(pts, 'd', 16).d, 20);
    assert.equal(L.nearest(pts, 'd', -5).d, 0);
    assert.equal(L.nearest(pts, 'd', 99).d, 30);
  });
  test('metric values and labels', () => {
    assert.equal(L.metricValue({gear: -1}, 'gear'), 0);
    assert.equal(L.metricValue({speed: 250}, 'speed'), 250);
    assert.equal(L.fmtMetric(250.4, 'speed'), '250 km/h');
    assert.equal(L.fmtMetric(0, 'gear'), 'N');
    assert.equal(L.fmtMetric(7, 'gear'), '7');
    assert.equal(L.fmtMetric(0.456, 'thr'), '46%');
    assert.equal(L.fmtDelta(-2.4, 'speed'), '−2');
    assert.equal(L.fmtDelta(1, 'gear'), '+1');
    assert.equal(L.fmtDelta(0, 'thr'), '±0%');
  });
});

describe('strategy projections', () => {
  test('laps until each corner reaches the limit, and the worst corner', () => {
    const p = L.tyreProjection({wear: [10, 20, 30, 40], wearRate: [1, 2, 3, 6]}, 70);
    assert.deepEqual(p.corners.map(c => [c.n, c.left]), [['FL', 40 / 3], ['FR', 5], ['RL', 60], ['RR', 25]]);
    assert.equal(p.worst.n, 'FR');
  });
  test('past the limit, not wearing, and unknown rates', () => {
    const p = L.tyreProjection({wear: [80, 10, 10, 10], wearRate: null}, 70);
    assert.deepEqual(p.corners.map(c => c.left), [null, null, 0, null]);
    assert.equal(p.worst.n, 'RL');
    const flat = L.tyreProjection({wear: [1, 1, 1, 1], wearRate: [0, 0, 0, 0.01]}, 70);
    assert.equal(flat.worst.left, Infinity);
    assert.equal(L.tyreProjection(null, 70), null);
    assert.equal(L.tyreProjection({wear: null}, 70), null);
    assert.equal(L.tyreProjection({wear: [1, 1, 1, 1]}, 70).worst, null);
  });
  test('rejoin estimate places you after the pit loss', () => {
    const rivals = [
      {pos: 1, gapLeader: 0, result: 2, name: 'A'},
      {pos: 2, gapLeader: 5000, result: 2, name: 'YOU', player: true},
      {pos: 3, gapLeader: 18000, result: 2, name: 'C'},
      {pos: 4, gapLeader: 30000, result: 2, name: 'D'},
      {pos: 5, gapLeader: 0, result: 2, name: 'NO TIMING'},
      {pos: 6, gapLeader: 40000, result: 4, name: 'RETIRED'},
    ];
    const r = L.rejoinEstimate({pitLoss: {ms: 20000}, rivals}, rivals[1]);
    assert.equal(r.pos, 3);
    assert.equal(r.after, 25000);
    assert.equal(r.ahead.r.name, 'C');
    assert.equal(r.behind.r.name, 'D');
  });
  test('no rejoin estimate without pit loss, a car, or timing', () => {
    const me = {pos: 2, gapLeader: 0};
    assert.equal(L.rejoinEstimate({pitLoss: null}, me), null);
    assert.equal(L.rejoinEstimate({pitLoss: {ms: 1}}, null), null);
    assert.equal(L.rejoinEstimate({pitLoss: {ms: 1}, rivals: []}, me), null);
    assert.equal(L.rejoinEstimate({pitLoss: {ms: 1}}, {pos: 1, gapLeader: 0}).pos, 1);
  });
  test('battle trend from your point of view', () => {
    assert.deepEqual(L.battleTrend(2000, null, true), {text: 'measuring…', cls: 'dim'});
    assert.deepEqual(L.battleTrend(1600, -300, true), {text: 'catching 0.30s/lap · DRS in 2 laps', cls: 'good'});
    assert.deepEqual(L.battleTrend(1100, -300, true), {text: 'catching 0.30s/lap · DRS in 1 lap', cls: 'good'});
    assert.deepEqual(L.battleTrend(800, -300, false), {text: 'closing 0.30s/lap · in DRS range', cls: 'bad'});
    assert.deepEqual(L.battleTrend(800, 200, true), {text: 'pulling away 0.20s/lap', cls: 'bad'});
    assert.deepEqual(L.battleTrend(800, 200, false), {text: 'dropping back 0.20s/lap', cls: 'good'});
    assert.deepEqual(L.battleTrend(800, 10, false), {text: 'holding the gap', cls: 'dim'});
  });
});

describe('UDP format 2026', () => {
  test('ERS mode 3 is Boost in 2026 and Overtake before', () => {
    assert.equal(L.ersModeName(3, 2026), 'Boost');
    assert.equal(L.ersModeName(3, 2025), 'Overtake');
    assert.equal(L.ersModeName(2, 2026), 'Hotlap');
    assert.equal(L.ersModeName(9, 2026), '');
  });
  test('zone fractions become distance ranges, splitting zones across the line', () => {
    assert.deepEqual(L.zoneRanges([[0.1, 0.2]], 5000), [[500, 1000]]);
    assert.deepEqual(L.zoneRanges([[0.95, 0.04]], 1000), [[950, 1000], [0, 40]]);
    assert.deepEqual(L.zoneRanges([[0.3, 0.3]], 1000), [], 'empty zone skipped');
    assert.deepEqual(L.zoneRanges(undefined, 1000), []);
    assert.deepEqual(L.zoneRanges([[0.1, 0.2]], 0), [], 'no track length yet');
  });
  test('overtake badge on 2026 cars, DRS otherwise', () => {
    const reg = {m_2026Regulations: 1, m_overtakeActive: 0, m_overtakeAvailable: 1};
    assert.deepEqual(L.boostBadge({m_drs: 1}, reg), {label: 'OVERTAKE', on: false, avail: true});
    assert.deepEqual(L.boostBadge({}, {...reg, m_overtakeActive: 1}), {label: 'OVERTAKE', on: true, avail: false});
    assert.deepEqual(L.boostBadge({m_drs: 1}, null), {label: 'DRS', on: true, avail: false});
    assert.deepEqual(L.boostBadge({m_drs: 1}, {...reg, m_2026Regulations: 0}), {label: 'DRS', on: true, avail: false});
    assert.deepEqual(L.boostBadge(null, null), {label: 'DRS', on: false, avail: false});
  });
  test('active aero label', () => {
    assert.equal(L.aeroLabel({m_activeAeroAvailable: 1, m_activeAeroMode: 1}), 'STRAIGHT');
    assert.equal(L.aeroLabel({m_activeAeroAvailable: 1, m_activeAeroMode: 0}), 'CORNER');
    assert.equal(L.aeroLabel({m_activeAeroAvailable: 0, m_activeAeroMode: 1}), null);
    assert.equal(L.aeroLabel(null), null);
  });
});

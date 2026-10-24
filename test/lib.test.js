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

describe('battery and best-lap traces', () => {
  const tel = speed => ({m_speed: speed, m_throttle: 1, m_brake: 0, m_gear: 5});
  const st = (store, mode) => ({m_ersStoreEnergy: store, m_ersDeployMode: mode});
  const lap = (n, d, last = 0, invalid = 0) => ({m_currentLapNum: n, m_lapDistance: d, m_lastLapTimeInMS: last, m_currentLapInvalid: invalid});
  // a full lap n from the line, 0..98 m in 2 m steps; `last` is the previous lap's time
  const drive = (traces, n, last, {from = 0, invalidAt = -1} = {}) => {
    for (let d = from; d < 100; d += 2) L.recordLapTrace(traces, 0, tel(d), lap(n, d, last, d >= invalidAt && invalidAt >= 0 ? 1 : 0), st(2000000, 2));
  };
  const cross = (traces, n, time) => L.recordLapTrace(traces, 0, tel(0), lap(n, 0, time), st(0, 0));
  test('samples carry the battery charge (clamped 0..1) and deploy mode', () => {
    const traces = new Map();
    L.recordLapTrace(traces, 0, tel(100), lap(1, 0), st(1000000, 3));
    L.recordLapTrace(traces, 0, tel(100), lap(1, 10), st(9e9, 1));
    L.recordLapTrace(traces, 0, tel(100), lap(1, 20));
    assert.deepEqual(traces.get(0).cur.map(p => [p.ers, p.mode]), [[0.25, 3], [1, 1], [null, null]], 'no status yet: unknown, not empty');
  });
  test('samples are rounded so history snapshots stay small', () => {
    const s = L.traceSample({m_speed: 200, m_throttle: 0.123456, m_brake: 0.98765, m_gear: 6}, st(1234567, 1));
    assert.deepEqual(s, {speed: 200, thr: 0.123, brk: 0.988, gear: 6, ers: 0.309, mode: 1});
    const traces = new Map();
    L.recordLapTrace(traces, 0, tel(1), lap(1, 12.3456));
    assert.equal(traces.get(0).cur[0].d, 12.3);
  });
  test('the best lap is kept by lap time, not by being the latest', () => {
    const traces = new Map();
    drive(traces, 1);
    drive(traces, 2, 90000);
    assert.equal(traces.get(0).bestLap, 1);
    assert.equal(traces.get(0).bestTime, 90000);
    drive(traces, 3, 95000);
    assert.equal(traces.get(0).bestLap, 1, 'a slower lap does not replace it');
    assert.equal(traces.get(0).lastLap, 2);
    drive(traces, 4, 89000);
    cross(traces, 5, 88000);
    assert.equal(traces.get(0).bestLap, 4);
    assert.equal(traces.get(0).bestTime, 88000);
  });
  test('a lap without a time or with too few samples is never the best', () => {
    const traces = new Map();
    drive(traces, 1);
    cross(traces, 2, 0);
    assert.equal(traces.get(0).bestLap, null);
    cross(traces, 3, 80000);
    assert.equal(traces.get(0).bestLap, null, 'one sample is not a lap');
  });
  test('a lap joined part-way (server started mid-lap, replay seek) is never the best', () => {
    const traces = new Map();
    drive(traces, 1, 0, {from: 0}); // fine, but untimed
    cross(traces, 2, 0);
    for (let d = 300; d < 400; d += 2) L.recordLapTrace(traces, 0, tel(d), lap(2, d), st(0, 0));
    cross(traces, 3, 70000);
    assert.equal(traces.get(0).bestLap, null, 'started 300 m after the line');
    assert.equal(traces.get(0).lastLap, 2, 'still shown as the last lap');
    drive(traces, 3);
    for (let d = 400; d < 500; d += 2) L.recordLapTrace(traces, 0, tel(d), lap(3, d), st(0, 0));
    cross(traces, 4, 70000);
    assert.equal(traces.get(0).bestLap, null, 'a 300 m hole in the middle (seek forward)');
  });
  test('an invalid lap is never the best, and the flag clears for the next lap', () => {
    const traces = new Map();
    drive(traces, 1, 0, {invalidAt: 50});
    cross(traces, 2, 80000);
    assert.equal(traces.get(0).bestLap, null);
    assert.equal(traces.get(0).invalid, false);
    drive(traces, 2, 80000);
    cross(traces, 3, 85000);
    assert.equal(traces.get(0).bestLap, 2);
  });
  test('battery metrics are labelled', () => {
    assert.equal(L.fmtMetric(0.5, 'ers'), '50%');
    assert.equal(L.fmtMetric(2, 'mode'), 'Hotlap');
    assert.equal(L.fmtMetric(3, 'mode', 2026), 'Boost');
    assert.equal(L.fmtMetric(9, 'mode'), '–');
    assert.equal(L.fmtDelta(-0.25, 'ers'), '−25%');
  });
});

describe('per-car history', () => {
  const tel = speed => ({m_speed: speed, m_throttle: 0.5, m_brake: 0, m_gear: 3});
  const lap = d => ({m_currentLapNum: 1, m_lapDistance: d, m_lastLapTimeInMS: 0});
  test('records a trail at a limited rate and forgets samples older than 3 minutes', () => {
    const h = L.createHistory();
    L.recordHistory(h, 4, tel(1), lap(0), null, 1000);
    L.recordHistory(h, 4, tel(2), lap(5), null, 1010);
    L.recordHistory(h, 4, tel(3), lap(10), null, 1060);
    assert.deepEqual(h.trails.get(4).map(p => p.speed), [1, 3], 'a sample 10 ms after the last is skipped');
    L.recordHistory(h, 4, tel(4), lap(15), null, 1000 + 180000);
    assert.deepEqual(h.trails.get(4).map(p => p.speed), [1, 3, 4], 'exactly 3 min old: still kept');
    L.recordHistory(h, 4, tel(5), lap(20), null, 1060 + 180001);
    assert.deepEqual(h.trails.get(4).map(p => p.speed), [4, 5]);
    assert.equal(h.laps.get(4).cur.length, 5, 'the lap trace records every call');
  });
  test('works without lap data; unknown cars have no snapshot', () => {
    const h = L.createHistory();
    L.recordHistory(h, 1, tel(1), null, null, 5);
    assert.equal(h.trails.get(1).length, 1);
    assert.equal(L.historySnapshot(h, 1, 5).lt, null);
    assert.equal(L.historySnapshot(h, 2, 5), null);
  });
  test('snapshots use ages, so the receiver can rebuild times on its own clock', () => {
    const h = L.createHistory();
    L.recordHistory(h, 2, tel(10), lap(0), null, 1000);
    L.recordHistory(h, 2, tel(20), lap(4), null, 1500);
    const snap = JSON.parse(JSON.stringify(L.historySnapshot(h, 2, 2000)));
    assert.deepEqual(snap.trail, [1000, 10, 0.5, 0, 3, null, null, 500, 20, 0.5, 0, 3, null, null], 'packed: age, then the sample');
    assert.deepEqual(L.historyTrail(snap, 50000), [
      {t: 49000, speed: 10, thr: 0.5, brk: 0, gear: 3, ers: null, mode: null},
      {t: 49500, speed: 20, thr: 0.5, brk: 0, gear: 3, ers: null, mode: null},
    ]);
    assert.deepEqual(L.historyLaps(snap).cur, h.laps.get(2).cur, 'lap traces come back as recorded');
    assert.equal(L.historyLaps({trail: [], lt: null}), null);
  });
  test('a best lap that is also the last lap is sent once and comes back shared', () => {
    const h = L.createHistory();
    const at = (n, d, last) => ({m_currentLapNum: n, m_lapDistance: d, m_lastLapTimeInMS: last});
    for (let d = 0; d < 100; d += 2) L.recordHistory(h, 0, tel(d), at(1, d, 0), null, d * 100);
    L.recordHistory(h, 0, tel(0), at(2, 0, 90000), null, 20000);
    const snap = JSON.parse(JSON.stringify(L.historySnapshot(h, 0, 20000)));
    assert.equal(snap.lt.best, 'last');
    const lt = L.historyLaps(snap);
    assert.equal(lt.best, lt.last);
    assert.equal(lt.best.length, 50);
    for (let d = 0; d < 100; d += 2) L.recordHistory(h, 0, tel(d), at(2, d, 90000), null, 30000 + d * 100);
    L.recordHistory(h, 0, tel(0), at(3, 0, 95000), null, 50000);
    const slower = L.historyLaps(JSON.parse(JSON.stringify(L.historySnapshot(h, 0, 50000))));
    assert.equal(slower.bestLap, 1);
    assert.equal(slower.lastLap, 2);
    assert.deepEqual(slower.best.map(p => p.d), h.laps.get(0).best.map(p => p.d), 'a different best lap is sent in full');
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
  test('overtake badge: flags alone do not mean the car is using it', () => {
    const reg = {m_2026Regulations: 1, m_overtakeAvailable: 1, m_overtakeActive: 1, m_overtakeActivationDistance: 0};
    const boost = {m_ersDeployMode: 3}, medium = {m_ersDeployMode: 1};
    assert.deepEqual(L.boostBadge({}, reg, boost), {label: 'OVERTAKE', on: true, avail: false, wait: 0});
    // real F1 26 data: available = active = 1 for every car all race, so not using Boost means "available"
    assert.deepEqual(L.boostBadge({}, reg, medium), {label: 'OVERTAKE', on: false, avail: true, wait: 0});
    assert.deepEqual(L.boostBadge({}, reg, null), {label: 'OVERTAKE', on: false, avail: true, wait: 0});
    // a countdown means it is not available yet, whatever the flags say
    assert.deepEqual(L.boostBadge({}, {...reg, m_overtakeActivationDistance: 120}, boost), {label: 'OVERTAKE', on: false, avail: false, wait: 120});
    assert.equal(L.boostBadge({}, {...reg, m_overtakeAvailable: 0, m_overtakeActive: 0}, medium).avail, false, 'mode not enabled');
    assert.equal(L.boostBadge({}, {...reg, m_overtakeActive: 0}, boost).on, false, 'Boost without the active flag');
  });
  test('DRS badge for cars without 2026 regulations', () => {
    assert.deepEqual(L.boostBadge({m_drs: 1}, null, null), {label: 'DRS', on: true, avail: false, wait: 0});
    assert.deepEqual(L.boostBadge({m_drs: 1}, {m_2026Regulations: 0, m_overtakeActive: 1}, {m_ersDeployMode: 3}), {label: 'DRS', on: true, avail: false, wait: 0});
    assert.deepEqual(L.boostBadge(null, null), {label: 'DRS', on: false, avail: false, wait: 0});
    assert.equal(L.overtakeOn(null, null), false);
  });
  test('active aero label follows the mode even though the game never sets "available"', () => {
    assert.equal(L.aeroLabel({m_2026Regulations: 1, m_activeAeroAvailable: 0, m_activeAeroMode: 1}), 'STRAIGHT');
    assert.equal(L.aeroLabel({m_2026Regulations: 1, m_activeAeroAvailable: 0, m_activeAeroMode: 0}), 'CORNER');
    assert.equal(L.aeroLabel({m_2026Regulations: 0, m_activeAeroMode: 1}), null, 'pre-2026 car');
    assert.equal(L.aeroLabel(null), null);
  });
});

describe('lap type tag', () => {
  test('flying and out laps get a tag; in laps, garage and plain on-track do not', () => {
    assert.deepEqual(L.lapTag(1), {label: 'FLY', cls: 'fly', title: 'Flying lap'});
    assert.deepEqual(L.lapTag(3), {label: 'OUT', cls: 'out', title: 'Out lap'});
    for (const s of [0, 2, 4, undefined, 9]) assert.equal(L.lapTag(s), null, `status ${s}: no tag (in laps are not tagged)`);
  });
});

describe('file size', () => {
  test('MB with one decimal, GB above 1 GiB, never 0.0', () => {
    assert.equal(L.fmtSize(2621440), '2.5 MB');
    assert.equal(L.fmtSize(126515802), '120.7 MB');
    assert.equal(L.fmtSize(3 * 1073741824), '3.0 GB');
    assert.equal(L.fmtSize(10), '0.1 MB');
  });
});

describe('overtake available (battery colour)', () => {
  const t2 = {m_2026Regulations: 1, m_overtakeAvailable: 1, m_overtakeActive: 1, m_overtakeActivationDistance: 0};
  test('only in race sessions, with the countdown finished', () => {
    for (const s of [15, 16, 17]) assert.equal(L.overtakeReady(t2, s), true);
    for (const s of [0, 1, 4, 5, 8, 10, 13, undefined]) assert.equal(L.overtakeReady(t2, s), false, `session ${s}: the game sets the flag for everyone`);
    assert.equal(L.overtakeReady({...t2, m_overtakeActivationDistance: 80}, 15), false);
    assert.equal(L.overtakeReady({...t2, m_overtakeAvailable: 0}, 15), false);
    assert.equal(L.overtakeReady({...t2, m_2026Regulations: 0}, 15), false);
    assert.equal(L.overtakeReady(null, 15), false);
  });
});

describe('session label', () => {
  test('name, lap (of the total in a race) and time left when timed', () => {
    assert.equal(L.sessionLabel({sessionType: 15, totalLaps: 30, timeLeft: 900}, 12), 'Race · LAP 12/30', 'races show laps, not the clock');
    assert.equal(L.sessionLabel({sessionType: 5, totalLaps: 0, timeLeft: 754}, 3), 'Qualifying 1 · LAP 3 · 12:34 LEFT');
    assert.equal(L.sessionLabel({sessionType: 1, timeLeft: 3600}, 0), 'Practice 1 · 60:00 LEFT', 'no lap yet');
    assert.equal(L.sessionLabel({sessionType: 16, totalLaps: 0}, 2), 'Race 2 · LAP 2', 'unknown total');
    assert.equal(L.sessionLabel({sessionType: 8, timeLeft: 0}, 1), 'Short Qualifying · LAP 1');
    assert.equal(L.sessionLabel({sessionType: 0}, 4), '', 'unknown session');
    assert.equal(L.sessionLabel(null, 4), '');
  });
});

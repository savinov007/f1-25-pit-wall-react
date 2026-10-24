// Pure dashboard logic shared by the page (window.PitLib) and the unit tests (require('./public/lib')).
// Nothing here touches the DOM.
(function (root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else root.PitLib = lib;
})(typeof self !== 'undefined' ? self : this, () => {
  const WEATHER = ['Clear', 'Light cloud', 'Overcast', 'Light rain', 'Heavy rain', 'Storm'];
  const ERS_MODES = ['None', 'Medium', 'Hotlap', 'Overtake'];
  const COMPOUNDS = {
    16: ['Soft', '#f92d29'], 17: ['Medium', '#ebd25f'], 18: ['Hard', '#ffffff'],
    7: ['Intermediate', '#3ac82b'], 8: ['Wet', '#4491d2'],
  };

  // Visual order FL FR RL RR; the game's arrays are RL RR FL FR. x/y/w/h place each tyre on the car diagram.
  const TYRES = [
    {n: 'FL', i: 2, area: 'fl', side: 'l', x: 5, y: 26, w: 19, h: 42},
    {n: 'FR', i: 3, area: 'fr', side: 'r', x: 76, y: 26, w: 19, h: 42},
    {n: 'RL', i: 0, area: 'rl', side: 'l', x: 2, y: 128, w: 23, h: 46},
    {n: 'RR', i: 1, area: 'rr', side: 'r', x: 75, y: 128, w: 23, h: 46},
  ];
  const CAR_PARTS = [
    ['fwl', 'm_frontLeftWingDamage'], ['fwr', 'm_frontRightWingDamage'], ['rw', 'm_rearWingDamage'],
    ['floor', 'm_floorDamage'], ['dif', 'm_diffuserDamage'], ['spl', 'm_sidepodDamage'], ['spr', 'm_sidepodDamage'],
  ];
  const DMG_KEYS = [
    ['m_frontLeftWingDamage', 'FL wing'], ['m_frontRightWingDamage', 'FR wing'], ['m_rearWingDamage', 'Rear wing'],
    ['m_floorDamage', 'Floor'], ['m_diffuserDamage', 'Diffuser'], ['m_sidepodDamage', 'Sidepods'],
    ['m_gearBoxDamage', 'Gearbox'], ['m_engineDamage', 'Engine'],
  ];

  // Colour scales. Temperature bands are approximate working windows for the game's surface temps.
  const tempColor = t => (t < 80 ? '#3aa0ff' : t < 105 ? '#1fd166' : t < 115 ? '#ffb020' : '#ff2d1f');
  const wearColor = w => (w < 25 ? '#1fd166' : w < 45 ? '#e6d84a' : w < 65 ? '#ffb020' : '#ff2d1f');
  const dmgLevel = v => (v <= 0 ? 0 : v < 20 ? 1 : v < 50 ? 2 : 3);
  const DMG_COLORS = ['', 'rgba(255, 176, 32, .45)', 'rgba(255, 122, 26, .85)', '#ff2d1f'];
  const cap = s => s[0].toUpperCase() + s.slice(1);

  const fmtTime = ms => {
    if (!ms) return '–';
    const m = Math.floor(ms / 60000), s = (ms % 60000) / 1000;
    return `${m}:${s.toFixed(3).padStart(6, '0')}`;
  };
  const fmtSector = ms => (ms ? (ms / 1000).toFixed(3) : '–');
  // the game sends huge deltas for cars still in the garage; anything over 10 minutes is meaningless
  const fmtGap = (ms, leader) => (leader ? 'LEADER' : ms && ms < 600000 ? '+' + (ms / 1000).toFixed(3) : '–');
  const esc = t => String(t).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const fmtClock = sec => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

  const gapOk = ms => ms >= 0 && ms < 600000;
  // gap to the leader in ms, or null when unknown (the game reports 0 for cars without timing yet)
  const leaderGap = r => (r.pos === 1 ? 0 : r.gapLeader > 0 && r.gapLeader < 600000 ? r.gapLeader : null);

  // --- Track map: outline learned from every car, bucketed by lap distance ---
  const TRACK_BUCKET_M = 8;
  // Pit-lane and inactive cars are skipped so the outline stays on the circuit.
  function learnTrack(track, rivals) {
    for (const r of rivals || []) {
      if (r.pit || r.result !== 2 || !(r.dist >= 0) || !(r.x || r.z)) continue;
      const k = Math.floor(r.dist / TRACK_BUCKET_M);
      // a car teleporting (garage -> grid, flashbacks) reports a position nowhere near its lap distance:
      // ignore points that sit far from an already-known neighbouring bucket
      const near = track.get(k - 1) || track.get(k + 1);
      if (near && Math.hypot(near.x - r.x, near.z - r.z) > TRACK_BUCKET_M * 6) continue;
      const p = track.get(k);
      // light smoothing as several cars pass the same spot
      track.set(k, p ? {x: p.x * 0.8 + r.x * 0.2, z: p.z * 0.8 + r.z * 0.2} : {x: r.x, z: r.z});
    }
    return track;
  }

  // --- Compare chart: lap-synced traces, samples keyed by lap distance ---
  const ERS_MAX = 4000000;
  const round3 = v => Math.round(v * 1000) / 1000; // charts don't need more, and history snapshots stay small
  // one chart sample: pedals, gear and the battery (charge 0..1 and deploy mode). Without a status packet yet
  // (it can arrive after the first telemetry) the battery is unknown (null), not an empty battery.
  const traceSample = (t, st) => ({
    speed: t.m_speed, thr: round3(t.m_throttle), brk: round3(t.m_brake), gear: t.m_gear,
    ers: st ? round3(Math.max(0, Math.min(1, st.m_ersStoreEnergy / ERS_MAX))) : null, mode: st ? st.m_ersDeployMode : null,
  });
  // a lap trace good enough to be a best-lap reference: starts at the line and has no holes
  // (joining mid-lap, or a replay seek, leaves part of the lap unrecorded)
  const LAP_HOLE_M = 200;
  const wholeLap = pts => pts.length > 20 && pts[0].d <= LAP_HOLE_M && pts.every((p, i) => !i || p.d - pts[i - 1].d <= LAP_HOLE_M);
  function recordLapTrace(traces, idx, t, lap, st) {
    const dist = lap.m_lapDistance, lapNum = lap.m_currentLapNum;
    let lt = traces.get(idx);
    if (!lt) { lt = {lap: lapNum, cur: [], last: [], lastLap: null, best: [], bestLap: null, bestTime: 0, invalid: false}; traces.set(idx, lt); }
    if (lapNum !== lt.lap) {
      // keep the finished lap only if it was mostly recorded (we may have joined mid-lap)
      if (lt.cur.length > 20) { lt.last = lt.cur; lt.lastLap = lt.lap; }
      // the best lap: fastest fully recorded valid lap, timed by the game (this packet's last lap time)
      const time = lap.m_lastLapTimeInMS;
      if (time > 0 && !lt.invalid && (!lt.bestTime || time < lt.bestTime) && wholeLap(lt.cur)) {
        lt.best = lt.cur; lt.bestLap = lt.lap; lt.bestTime = time;
      }
      lt.cur = [];
      lt.lap = lapNum;
      lt.invalid = false;
    }
    if (lap.m_currentLapInvalid) lt.invalid = true; // cut a corner: the lap can't be the best
    if (!(dist >= 0)) return lt; // before the start line on lap 1
    let prev = lt.cur[lt.cur.length - 1];
    if (prev && dist < prev.d - 30) {
      // flashback / rewind: drop the part of the lap that was undone
      lt.cur = lt.cur.filter(p => p.d <= dist);
      prev = lt.cur[lt.cur.length - 1];
    }
    if (!prev || dist - prev.d >= 2) lt.cur.push({d: Math.round(dist * 10) / 10, ...traceSample(t, st)});
    return lt;
  }

  // nearest sample to `key` in a list sorted by `field` (binary search)
  function nearest(pts, field, key) {
    let lo = 0, hi = pts.length - 1;
    if (hi < 0) return null;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pts[mid][field] < key) lo = mid + 1; else hi = mid;
    }
    const a = pts[Math.max(0, lo - 1)], b = pts[lo];
    return Math.abs(a[field] - key) <= Math.abs(b[field] - key) ? a : b;
  }
  const metricValue = (p, m) => (m === 'gear' ? Math.max(0, p.gear) : p[m]);
  const fmtMetric = (v, m, format) =>
    m === 'speed' ? Math.round(v) + ' km/h' : m === 'gear' ? (v ? String(v) : 'N') : m === 'mode' ? ersModeName(v, format) || '–' : Math.round(v * 100) + '%';
  const fmtDelta = (v, m) => {
    const sign = v > 0 ? '+' : v < 0 ? '−' : '±';
    const abs = Math.abs(v);
    return sign + (m === 'speed' ? Math.round(abs) : m === 'gear' ? abs : Math.round(abs * 100) + '%');
  };

  // Rolling per-car history kept by the server, so a chart opened late is already filled:
  // trails: idx -> time samples {t, ...traceSample}; laps: idx -> lap traces as built by recordLapTrace.
  // The trail covers the longest live chart window (compare: 3 min).
  const TRAIL_MS = 180000, TRAIL_STEP_MS = 50;
  const createHistory = () => ({trails: new Map(), laps: new Map()});
  function recordHistory(h, idx, t, lap, st, now) {
    let trail = h.trails.get(idx);
    if (!trail) h.trails.set(idx, (trail = []));
    const last = trail[trail.length - 1];
    if (!last || now - last.t >= TRAIL_STEP_MS) trail.push({t: now, ...traceSample(t, st)});
    while (trail.length && now - trail[0].t > TRAIL_MS) trail.shift();
    if (lap) recordLapTrace(h.laps, idx, t, lap, st);
  }
  // Wire form for one car (null when nothing is recorded). Samples are packed as flat number arrays,
  // [x, speed, thr, brk, gear, ers, mode, x, ...], about half the size of objects with repeated keys.
  // Trail times become ages (x = a), so client and server clocks needn't agree; lap traces keep x = d.
  // A best lap that is also the last lap is sent once ('last').
  const SAMPLE_KEYS = ['speed', 'thr', 'brk', 'gear', 'ers', 'mode'];
  const STRIDE = SAMPLE_KEYS.length + 1;
  function packPoints(pts, x, xOf = p => p[x]) {
    const out = [];
    for (const p of pts) out.push(xOf(p), ...SAMPLE_KEYS.map(k => p[k]));
    return out;
  }
  function unpackPoints(flat, x, xOf = v => v) {
    const pts = [];
    for (let i = 0; i + STRIDE <= flat.length; i += STRIDE) {
      const p = {[x]: xOf(flat[i])};
      SAMPLE_KEYS.forEach((k, j) => { p[k] = flat[i + 1 + j]; });
      pts.push(p);
    }
    return pts;
  }
  function historySnapshot(h, idx, now) {
    const trail = h.trails.get(idx);
    if (!trail) return null;
    const lt = h.laps.get(idx);
    return {
      trail: packPoints(trail, 'a', p => now - p.t),
      lt: lt ? {...lt, cur: packPoints(lt.cur, 'd'), last: packPoints(lt.last, 'd'), best: lt.best === lt.last ? 'last' : packPoints(lt.best, 'd')} : null,
    };
  }
  // the receiving side: the trail on the local clock, and lap traces in the shape recordLapTrace builds
  const historyTrail = (snap, now) => unpackPoints(snap.trail, 't', a => now - a);
  function historyLaps(snap) {
    if (!snap.lt) return null;
    const last = unpackPoints(snap.lt.last, 'd');
    return {...snap.lt, cur: unpackPoints(snap.lt.cur, 'd'), last, best: snap.lt.best === 'last' ? last : unpackPoints(snap.lt.best, 'd')};
  }

  // --- Strategy projections from the server's measured rates ---
  // laps until each corner reaches the wear limit (Infinity when it isn't wearing, 0 when already past)
  function tyreProjection(st, limit) {
    if (!st || !st.wear) return null;
    const corners = TYRES.map(ty => {
      const w = st.wear[ty.i], rate = st.wearRate ? st.wearRate[ty.i] : null;
      const left = w >= limit ? 0 : rate == null ? null : rate > 0.05 ? (limit - w) / rate : Infinity;
      return {n: ty.n, wear: w, rate, left};
    });
    const known = corners.filter(c => c.left != null);
    const worst = known.length ? known.reduce((a, b) => (b.left < a.left ? b : a)) : null;
    return {corners, worst};
  }
  const fmtLaps = n => (n == null ? '–' : !isFinite(n) ? '∞' : n < 10 ? n.toFixed(1) : String(Math.round(n)));
  const lapsColor = n => (n == null || !isFinite(n) ? 'var(--green)' : n < 3 ? 'var(--red-hi)' : n < 6 ? 'var(--amber)' : 'var(--green)');
  const fmtS = ms => (ms / 1000).toFixed(Math.abs(ms) >= 10000 ? 1 : 2);
  const fmtRate = ms => (ms >= 0 ? '+' : '−') + fmtS(Math.abs(ms)) + 's';
  const nameOf = r => esc(r.name.slice(0, 12).toUpperCase());

  // where you'd come out if you pitted now: your gap to the leader plus the measured pit loss
  function rejoinEstimate(s, me) {
    if (!s.pitLoss || !me) return null;
    const mine = leaderGap(me);
    if (mine == null) return null;
    const after = mine + s.pitLoss.ms;
    const others = (s.rivals || [])
      .filter(r => !r.player && r.result === 2)
      .map(r => ({r, g: leaderGap(r)}))
      .filter(o => o.g != null)
      .sort((a, b) => a.g - b.g);
    const ahead = others.filter(o => o.g <= after), behind = others.filter(o => o.g > after);
    return {pos: ahead.length + 1, ahead: ahead[ahead.length - 1], behind: behind[0], after};
  }

  // How a gap is moving, from your point of view. chasing = the car is ahead of you.
  function battleTrend(gapMs, rateMs, chasing) {
    if (rateMs == null) return {text: 'measuring…', cls: 'dim'};
    const lapsTo = target => Math.max(1, Math.ceil((gapMs - target) / -rateMs));
    if (rateMs < -30) {
      const drs = gapMs > 1000 ? `DRS in ${lapsTo(1000)} lap${lapsTo(1000) === 1 ? '' : 's'}` : 'in DRS range';
      return {text: `${chasing ? 'catching' : 'closing'} ${fmtS(-rateMs)}s/lap · ${drs}`, cls: chasing ? 'good' : 'bad'};
    }
    if (rateMs > 30) return {text: `${chasing ? 'pulling away' : 'dropping back'} ${fmtS(rateMs)}s/lap`, cls: chasing ? 'bad' : 'good'};
    return {text: 'holding the gap', cls: 'dim'};
  }

  // lap type from the game's driver status (0 garage, 1 flying lap, 2 in lap, 3 out lap, 4 on track): a standings tag
  const LAP_TAGS = {1: {label: 'FLY', cls: 'fly', title: 'Flying lap'}, 3: {label: 'OUT', cls: 'out', title: 'Out lap'}};
  const lapTag = driverStatus => LAP_TAGS[driverStatus] || null;

  // file size for the replay list
  const fmtSize = bytes => (bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(1)} GB` : `${Math.max(0.1, bytes / 1048576).toFixed(1)} MB`);

  const SESSION_NAMES = {
    1: 'Practice 1', 2: 'Practice 2', 3: 'Practice 3', 4: 'Short Practice', 5: 'Qualifying 1', 6: 'Qualifying 2', 7: 'Qualifying 3',
    8: 'Short Qualifying', 9: 'One-Shot Qualifying', 10: 'Sprint Shootout 1', 11: 'Sprint Shootout 2', 12: 'Sprint Shootout 3',
    13: 'Short Sprint Shootout', 14: 'One-Shot Sprint Shootout', 15: 'Race', 16: 'Race 2', 17: 'Race 3', 18: 'Time Trial',
  };
  // header text for the session: its name, the lap (of the total in a race) and the time left when it is timed
  function sessionLabel(se, lapNum) {
    if (!se || !SESSION_NAMES[se.sessionType]) return '';
    const race = RACE_SESSIONS.includes(se.sessionType);
    const parts = [SESSION_NAMES[se.sessionType]];
    if (lapNum > 0) parts.push(race && se.totalLaps > 0 ? `LAP ${lapNum}/${se.totalLaps}` : `LAP ${lapNum}`);
    if (!race && se.timeLeft > 0) parts.push(`${fmtClock(se.timeLeft)} LEFT`);
    return parts.join(' · ');
  }

  // --- UDP format 2026 (F1 25: 2026 Season Pack) ---
  // ERS deploy mode label: mode 3 is "Overtake" in the 2025 format and "Boost" in 2026
  const ersModeName = (mode, format) => (mode === 3 && format >= 2026 ? 'Boost' : ERS_MODES[mode] || '');
  // [start, end] lap fractions -> [startM, endM] distance ranges; a zone that wraps past the line splits in two
  function zoneRanges(zones, trackLength) {
    if (!trackLength) return [];
    const out = [];
    for (const [a, b] of zones || []) {
      if (a === b) continue;
      if (b > a) out.push([a * trackLength, b * trackLength]);
      else out.push([a * trackLength, trackLength], [0, b * trackLength]);
    }
    return out;
  }
  // Is the car using overtake mode? In real F1 26 data the available/active flags are 1 for every car for the
  // whole race (they only say the mode is enabled), so "using it" also needs the activation distance to have
  // run out and the car to be deploying in Boost (ERS mode 3).
  const overtakeOn = (t2, status) => !!(t2 && t2.m_2026Regulations && t2.m_overtakeActive && !t2.m_overtakeActivationDistance &&
    status && status.m_ersDeployMode === 3);
  // Does the car have overtake mode to use right now? The game sets the flags for every car in every session, so
  // availability only counts in race sessions (15 Race, 16 Race 2, 17 Race 3), with the activation countdown done.
  const RACE_SESSIONS = [15, 16, 17];
  const overtakeReady = (t2, sessionType) => !!(t2 && t2.m_2026Regulations && t2.m_overtakeAvailable &&
    !t2.m_overtakeActivationDistance && RACE_SESSIONS.includes(sessionType));
  // DRS / overtake badge: 2026-regulation cars have overtake mode instead of DRS. wait = metres until the mode
  // becomes available (0 when it is, or there is no countdown).
  function boostBadge(t, t2, status) {
    if (t2 && t2.m_2026Regulations) {
      const wait = t2.m_overtakeActivationDistance || 0;
      const on = overtakeOn(t2, status);
      return {label: 'OVERTAKE', on, avail: !on && !wait && !!(t2.m_overtakeAvailable || t2.m_overtakeActive), wait};
    }
    return {label: 'DRS', on: !!(t && t.m_drs), avail: false, wait: 0};
  }
  // active aero wing mode of a 2026 car. The game never sets m_activeAeroAvailable in practice, but the mode
  // itself follows the car (straight on the straights), so it is shown whenever the car is a 2026 car.
  const aeroLabel = t2 => (t2 && t2.m_2026Regulations ? (t2.m_activeAeroMode === 1 ? 'STRAIGHT' : 'CORNER') : null);

  return {
    ersModeName, zoneRanges, boostBadge, aeroLabel, overtakeOn, overtakeReady, sessionLabel, lapTag, fmtSize,
    WEATHER, ERS_MODES, COMPOUNDS, TYRES, CAR_PARTS, DMG_KEYS, DMG_COLORS, TRACK_BUCKET_M,
    tempColor, wearColor, dmgLevel, cap, fmtTime, fmtSector, fmtGap, esc, fmtClock, gapOk, leaderGap,
    learnTrack, recordLapTrace, createHistory, recordHistory, historySnapshot, historyTrail, historyLaps, packPoints, traceSample, nearest, metricValue, fmtMetric, fmtDelta,
    tyreProjection, fmtLaps, lapsColor, fmtS, fmtRate, nameOf, rejoinEstimate, battleTrend,
  };
});

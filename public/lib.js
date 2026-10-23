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
  function recordLapTrace(traces, idx, t, lap) {
    const dist = lap.m_lapDistance, lapNum = lap.m_currentLapNum;
    let lt = traces.get(idx);
    if (!lt) { lt = {lap: lapNum, cur: [], last: [], lastLap: null}; traces.set(idx, lt); }
    if (lapNum !== lt.lap) {
      // keep the finished lap only if it was mostly recorded (we may have joined mid-lap)
      if (lt.cur.length > 20) { lt.last = lt.cur; lt.lastLap = lt.lap; }
      lt.cur = [];
      lt.lap = lapNum;
    }
    if (!(dist >= 0)) return lt; // before the start line on lap 1
    let prev = lt.cur[lt.cur.length - 1];
    if (prev && dist < prev.d - 30) {
      // flashback / rewind: drop the part of the lap that was undone
      lt.cur = lt.cur.filter(p => p.d <= dist);
      prev = lt.cur[lt.cur.length - 1];
    }
    if (!prev || dist - prev.d >= 2) {
      lt.cur.push({d: dist, speed: t.m_speed, thr: t.m_throttle, brk: t.m_brake, gear: t.m_gear});
    }
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
  const fmtMetric = (v, m) => (m === 'speed' ? Math.round(v) + ' km/h' : m === 'gear' ? (v ? String(v) : 'N') : Math.round(v * 100) + '%');
  const fmtDelta = (v, m) => {
    const sign = v > 0 ? '+' : v < 0 ? '−' : '±';
    const abs = Math.abs(v);
    return sign + (m === 'speed' ? Math.round(abs) : m === 'gear' ? abs : Math.round(abs * 100) + '%');
  };

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
    ersModeName, zoneRanges, boostBadge, aeroLabel, overtakeOn,
    WEATHER, ERS_MODES, COMPOUNDS, TYRES, CAR_PARTS, DMG_KEYS, DMG_COLORS, TRACK_BUCKET_M,
    tempColor, wearColor, dmgLevel, cap, fmtTime, fmtSector, fmtGap, esc, fmtClock, gapOk, leaderGap,
    learnTrack, recordLapTrace, nearest, metricValue, fmtMetric, fmtDelta,
    tyreProjection, fmtLaps, lapsColor, fmtS, fmtRate, nameOf, rejoinEstimate, battleTrend,
  };
});

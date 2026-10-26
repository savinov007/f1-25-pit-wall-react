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

  // An outline is complete once nearly every bucket around the lap is known, with no long stretch missing.
  function outlineComplete(track, trackLength, {coverage = 0.98, maxGap = 4} = {}) {
    const n = Math.ceil(trackLength / TRACK_BUCKET_M);
    if (!(n > 0) || track.size < n * coverage) return false;
    let run = 0;
    for (let k = 0; k < n * 2; k++) { // twice round, so a gap across the start line counts as one
      run = track.has(k % n) ? 0 : run + 1;
      if (run > maxGap) return false;
    }
    return true;
  }
  // The outline as [[bucket, x, z]] around the lap, without spikes: a point far from both its neighbours is a car
  // that was somewhere else at that lap distance (on the grid, in the garage) before the guard in learnTrack had
  // neighbours to compare with.
  function outlinePoints(track, trackLength) {
    const n = Math.ceil(trackLength / TRACK_BUCKET_M);
    let pts = [...track.keys()].sort((a, b) => a - b).map(k => [k, Math.round(track.get(k).x * 10) / 10, Math.round(track.get(k).z * 10) / 10]);
    const apart = (a, b) => { const dk = Math.abs(a[0] - b[0]); return Math.max(1, Math.min(dk, n - dk)); }; // round the lap
    const far = (a, b) => Math.hypot(a[1] - b[1], a[2] - b[2]) > TRACK_BUCKET_M * 3 * apart(a, b);
    for (let changed = true; changed && pts.length > 2;) {
      const keep = pts.filter((p, i) => !(far(p, pts[(i + pts.length - 1) % pts.length]) && far(p, pts[(i + 1) % pts.length])));
      changed = keep.length < pts.length;
      pts = keep;
    }
    return pts;
  }

  // --- Corners: official corner numbers placed on the game's own outline ---
  // A closed polyline resampled to n points evenly spaced along it.
  function resample(pts, n) {
    const seg = pts.map((p, i) => { const q = pts[(i + 1) % pts.length]; return Math.hypot(q[0] - p[0], q[1] - p[1]); });
    const total = seg.reduce((a, b) => a + b, 0);
    const out = [];
    for (let k = 0, i = 0, acc = 0; k < n; k++) {
      const at = (k / n) * total;
      while (i < seg.length - 1 && acc + seg[i] < at) acc += seg[i++];
      const f = seg[i] ? (at - acc) / seg[i] : 0, p = pts[i], q = pts[(i + 1) % pts.length];
      out.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]);
    }
    return out;
  }
  // Best rotation + scale + shift taking points a onto b (2D Procrustes): {err, apply(p)}, err as an RMS distance.
  function similarity(a, b) {
    const n = a.length, ma = [0, 0], mb = [0, 0];
    for (let i = 0; i < n; i++) { ma[0] += a[i][0] / n; ma[1] += a[i][1] / n; mb[0] += b[i][0] / n; mb[1] += b[i][1] / n; }
    let dot = 0, cross = 0, na = 0, nb = 0;
    for (let i = 0; i < n; i++) {
      const ax = a[i][0] - ma[0], ay = a[i][1] - ma[1], bx = b[i][0] - mb[0], by = b[i][1] - mb[1];
      dot += ax * bx + ay * by; cross += ax * by - ay * bx; na += ax * ax + ay * ay; nb += bx * bx + by * by;
    }
    const c = dot / na, s = cross / na; // scale * cos, scale * sin
    return {
      err: Math.sqrt(Math.max(0, nb - (dot * dot + cross * cross) / na) / n),
      apply: p => [c * (p[0] - ma[0]) - s * (p[1] - ma[1]) + mb[0], s * (p[0] - ma[0]) + c * (p[1] - ma[1]) + mb[1]],
    };
  }
  // When time samples ({t, ld}) went through each corner ({n, d}): [{t, n}]. Samples are tens of milliseconds apart,
  // so a car covers a few metres between them: going further than CORNER_JUMP_M, forwards or over the start line,
  // is a replay seek, and any other step back a flashback or seek; neither is driving through a corner.
  const CORNER_JUMP_M = 300;
  function cornerPasses(samples, corners, trackLength) {
    const out = [];
    if (!corners || !corners.length) return out;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1].ld, b = samples[i].ld;
      if (a == null || b == null) continue;
      const wrapped = trackLength > 0 && b < a && trackLength - a + b <= CORNER_JUMP_M; // over the line
      if (!wrapped && (b < a || b - a > CORNER_JUMP_M)) continue;
      for (const c of corners) {
        if (wrapped ? c.d > a || c.d <= b : c.d > a && c.d <= b) out.push({t: samples[i].t, n: c.n});
      }
    }
    return out;
  }
  // the corner within `within` metres of a lap distance, or null
  function cornerAt(corners, d, within = 60) {
    let best = null;
    for (const c of corners || []) if (Math.abs(c.d - d) <= within && (!best || Math.abs(c.d - d) < Math.abs(best.d - d))) best = c;
    return best;
  }

  const FIT_N = 256, FIT_MAX_ERR = 0.03;
  // Official corners ({outline: [[x, y]], corners: [{n, x, y}]}, any coordinate system) placed on the game outline
  // (points: [[bucket, x, z]] around the lap): [{n, d}] with d in metres of lap distance, sorted by d. The official
  // outline is fitted onto the game's trying both directions, a mirror image (the axes may be flipped) and every
  // start point, so the game's lap distance stays the authority. A poor fit, or corners that come out of
  // order along the lap, gives [] rather than wrong numbers.
  function fitCorners(points, official) {
    if (!official || !points || points.length < 16 || !official.outline || official.outline.length < 16) return [];
    const game = resample(points.map(p => [p[1], p[2]]), FIT_N);
    let best = null;
    for (const mirror of [1, -1]) {
      for (const reverse of [false, true]) {
        const src = official.outline.map(([x, y]) => [x, y * mirror]);
        if (reverse) src.reverse();
        const ref = resample(src, FIT_N);
        for (let off = 0; off < FIT_N; off++) {
          const shifted = ref.slice(off).concat(ref.slice(0, off));
          const fit = similarity(shifted, game);
          if (!best || fit.err < best.err) best = {...fit, mirror};
        }
      }
    }
    const cx = game.reduce((a, p) => a + p[0], 0) / FIT_N, cz = game.reduce((a, p) => a + p[1], 0) / FIT_N;
    const size = Math.sqrt(game.reduce((a, p) => a + (p[0] - cx) ** 2 + (p[1] - cz) ** 2, 0) / FIT_N);
    if (!(best.err <= size * FIT_MAX_ERR)) return [];
    const placed = official.corners.map(c => {
      const [x, z] = best.apply([c.x, c.y * best.mirror]);
      let k = points[0][0], dist = Infinity;
      for (const p of points) {
        const dd = (p[1] - x) ** 2 + (p[2] - z) ** 2;
        if (dd < dist) { dist = dd; k = p[0]; }
      }
      return {n: c.n, d: k * TRACK_BUCKET_M + TRACK_BUCKET_M / 2};
    });
    // in official order the corners go round the lap once: at most one step back (across the start line)
    const backs = placed.filter((c, i) => i && c.d < placed[i - 1].d).length;
    if (backs > 1) return [];
    return placed.sort((a, b) => a.d - b.d);
  }

  // --- Compare chart: lap-synced traces, samples keyed by lap distance ---
  const ERS_MAX = 4000000;
  const round3 = v => Math.round(v * 1000) / 1000; // charts don't need more, and history snapshots stay small
  // one chart sample: pedals, gear, the battery (charge 0..1 and deploy mode) and where on the lap it was (ld, metres;
  // marks the corners on time charts). Without a status packet yet (it can arrive after the first telemetry) the
  // battery is unknown (null), not an empty battery; without lap data, so is the position.
  const traceSample = (t, st, lap) => ({
    speed: t.m_speed, thr: round3(t.m_throttle), brk: round3(t.m_brake), gear: t.m_gear,
    ers: st ? round3(Math.max(0, Math.min(1, st.m_ersStoreEnergy / ERS_MAX))) : null, mode: st ? st.m_ersDeployMode : null,
    ld: lap && lap.m_lapDistance >= 0 ? Math.round(lap.m_lapDistance) : null,
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
    if (!prev || dist - prev.d >= 2) lt.cur.push({d: Math.round(dist * 10) / 10, ...traceSample(t, st, lap)});
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
    if (!last || now - last.t >= TRAIL_STEP_MS) trail.push({t: now, ...traceSample(t, st, lap)});
    while (trail.length && now - trail[0].t > TRAIL_MS) trail.shift();
    if (lap) recordLapTrace(h.laps, idx, t, lap, st);
  }
  // Wire form for one car (null when nothing is recorded). Samples are packed as flat number arrays,
  // [x, speed, thr, brk, gear, ers, mode, ld, x, ...], about half the size of objects with repeated keys.
  // Trail times become ages (x = a), so client and server clocks needn't agree; lap traces keep x = d.
  // A best lap that is also the last lap is sent once ('last').
  const SAMPLE_KEYS = ['speed', 'thr', 'brk', 'gear', 'ers', 'mode', 'ld'];
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

  // --- Dashboard arrangement: which sections sit in which column, top to bottom ({cols: [[id, ...], ...]}) ---
  const MAX_COLS = 4;
  // A saved arrangement checked against the sections the page has: every section exactly once (unknown ones and
  // repeats dropped, missing ones added to the last column), no empty columns, at most MAX_COLS. Unusable: the fallback.
  function normalizeArrangement(saved, ids, fallback) {
    const copy = a => ({cols: a.cols.map(c => [...c])});
    if (!saved || !Array.isArray(saved.cols)) return copy(fallback);
    const seen = new Set();
    const keep = id => ids.includes(id) && !seen.has(id) && seen.add(id);
    const cols = saved.cols.filter(Array.isArray).map(c => c.filter(keep)).filter(c => c.length).slice(0, MAX_COLS);
    if (!cols.length) return copy(fallback);
    const placed = new Set(cols.flat());
    cols[cols.length - 1].push(...ids.filter(id => !placed.has(id)));
    return {cols};
  }
  // The arrangement with section `id` moved to column `col` at `index`, counted without the moved section.
  // Empty columns are kept: while editing, an empty column is a place to drop a section.
  function moveSection(arr, id, col, index) {
    const cols = arr.cols.map(c => c.filter(x => x !== id));
    if (!cols[col]) return {cols: arr.cols.map(c => [...c])};
    cols[col].splice(Math.max(0, Math.min(index, cols[col].length)), 0, id);
    return {cols};
  }

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
    MAX_COLS, normalizeArrangement, moveSection,
    outlineComplete, outlinePoints, fitCorners, cornerPasses, cornerAt,
    learnTrack, recordLapTrace, createHistory, recordHistory, historySnapshot, historyTrail, historyLaps, packPoints, traceSample, nearest, metricValue, fmtMetric, fmtDelta,
    tyreProjection, fmtLaps, lapsColor, fmtS, fmtRate, nameOf, rejoinEstimate, battleTrend,
  };
});

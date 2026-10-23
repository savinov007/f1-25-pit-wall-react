// Strategy models built from measured data rather than guessed constants:
//  - tyre wear rate per corner (least-squares over this stint's lap-end readings + the live reading)
//  - pace and degradation trend (recent clean laps)
//  - interval trend to the car ahead (how fast the gap is closing, lap by lap)
//  - pit-stop time loss at this track, measured from real stops by any car
// Game arrays use wheel order RL, RR, FL, FR.

const PACE_LAPS = 5;
const MAX_LAPS_KEPT = 60;
const MAX_GAPS_KEPT = 8;

const median = arr => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// least-squares slope of y over x
function slope(points) {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of points) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; }
  const d = n * sxx - sx * sx;
  return Math.abs(d) < 1e-9 ? null : (n * sxy - sx * sy) / d;
}

const gapToFrontMs = l =>
  l.m_deltaToCarInFrontMSPart !== undefined
    ? (l.m_deltaToCarInFrontMSPart || 0) + (l.m_deltaToCarInFrontMinutesPart || 0) * 60000
    : l.m_deltaToCarInFrontInMS || 0;

class StrategyTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.cars = new Map();
    this.pitLosses = [];
  }

  newCar(l, status) {
    return {
      lap: l.m_currentLapNum,
      stops: l.m_numPitStops,
      age: status ? status.m_tyresAgeLaps : null,
      laps: [],          // completed laps: {lap, timeMs, valid, pit}
      gaps: [],          // interval to the car ahead at each lap end: {lap, gapMs, aheadIdx}
      wearSamples: [],   // this stint, at clean lap ends: {x, wear[4]}
      stintStartLap: l.m_currentLapNum,
      pitThisLap: l.m_pitStatus > 0,
      invalidThisLap: false,
      stopPending: false,
      live: null,
    };
  }

  // Called with the full per-car arrays on every lap-data packet.
  update(lapArr, dmgArr, statusArr, trackLength) {
    if (!lapArr) return;
    lapArr.forEach((l, i) => {
      if (!l || l.m_resultStatus < 2) return;
      const status = statusArr && statusArr[i];
      const wear = dmgArr && dmgArr[i] ? [...dmgArr[i].m_tyresWear] : null;
      let c = this.cars.get(i);
      // first sighting, or a flashback / restart rewound the lap counter
      if (!c || l.m_currentLapNum < c.lap) {
        c = this.newCar(l, status);
        this.cars.set(i, c);
      }

      // new stint: a completed stop, or the tyre age went backwards (fresh set)
      const age = status ? status.m_tyresAgeLaps : null;
      if (l.m_numPitStops > c.stops || (age != null && c.age != null && age < c.age)) {
        if (l.m_numPitStops > c.stops) c.stopPending = true;
        c.stops = l.m_numPitStops;
        c.wearSamples = [];
        c.stintStartLap = l.m_currentLapNum;
      }
      if (age != null) c.age = age;
      if (l.m_pitStatus > 0) c.pitThisLap = true;
      if (l.m_currentLapInvalid) c.invalidThisLap = true;
      const frac = trackLength > 0 && l.m_lapDistance >= 0 ? Math.min(1, l.m_lapDistance / trackLength) : 0;
      c.live = {wear, x: l.m_currentLapNum - 1 + frac};

      if (l.m_currentLapNum > c.lap) this.completeLap(c, l, lapArr, wear);
    });
  }

  completeLap(c, l, lapArr, wear) {
    const done = c.lap;
    const rec = {lap: done, timeMs: l.m_lastLapTimeInMS, valid: !c.invalidThisLap, pit: c.pitThisLap};
    c.laps.push(rec);
    if (c.laps.length > MAX_LAPS_KEPT) c.laps.shift();

    // wear readings only from clean laps of the current stint (in/out laps straddle a tyre change)
    if (wear && !rec.pit) c.wearSamples.push({x: done, wear});

    // interval to the car ahead, measured at the line
    const gapMs = gapToFrontMs(l);
    if (l.m_carPosition > 1 && gapMs > 0 && gapMs < 600000) {
      const aheadIdx = lapArr.findIndex(o => o && o.m_carPosition === l.m_carPosition - 1);
      c.gaps.push({lap: done, gapMs, aheadIdx});
      if (c.gaps.length > MAX_GAPS_KEPT) c.gaps.shift();
    }

    // first clean lap after a stop: measure the stop's cost against this car's pace before it
    if (c.stopPending && !rec.pit) {
      c.stopPending = false;
      const before = c.laps.slice(0, -1);
      const pitLaps = [];
      for (let j = before.length - 1; j >= 0 && before[j].pit && pitLaps.length < 2; j--) pitLaps.unshift(before[j]);
      const refLaps = before.slice(0, before.length - pitLaps.length).filter(r => r.valid && !r.pit && r.timeMs > 0).slice(-3);
      // expected time for each pit lap had the car stayed out: extend the recent trend, else use the median
      const trend = refLaps.length >= 2 ? slope(refLaps.map(r => ({x: r.lap, y: r.timeMs}))) : null;
      const mean = refLaps.reduce((sum, r) => sum + r.timeMs, 0) / (refLaps.length || 1);
      const meanLap = refLaps.reduce((sum, r) => sum + r.lap, 0) / (refLaps.length || 1);
      const expected = lap => (trend == null ? median(refLaps.map(r => r.timeMs)) : mean + trend * (lap - meanLap));
      if (pitLaps.length && refLaps.length && pitLaps.every(r => r.timeMs > 0)) {
        const loss = pitLaps.reduce((sum, r) => sum + r.timeMs - expected(r.lap), 0);
        if (loss > 5000 && loss < 60000) this.pitLosses.push(loss);
      }
    }

    c.lap = l.m_currentLapNum;
    c.pitThisLap = l.m_pitStatus > 0;
    c.invalidThisLap = false;
  }

  summary(i) {
    const c = this.cars.get(i);
    if (!c) return null;

    // wear rate per corner (%/lap); needs at least ~3/4 of a lap of data in this stint
    const pts = [...c.wearSamples];
    if (c.live && c.live.wear) pts.push({x: c.live.x, wear: c.live.wear});
    let wearRate = null;
    if (pts.length >= 2 && pts[pts.length - 1].x - pts[0].x >= 0.75) {
      wearRate = [0, 1, 2, 3].map(k => {
        const s = slope(pts.map(p => ({x: p.x, y: p.wear[k]})));
        return s == null ? null : Math.max(0, s);
      });
    }

    // pace: recent clean laps, dropping outliers (traffic, mistakes) more than 3% off the median
    const clean = c.laps.filter(r => r.valid && !r.pit && r.timeMs > 0).slice(-PACE_LAPS);
    const med = median(clean.map(r => r.timeMs));
    const paceLaps = clean.filter(r => r.timeMs < med * 1.03);
    const pace = paceLaps.length
      ? {
          avgMs: median(paceLaps.slice(-3).map(r => r.timeMs)),
          trendMs: paceLaps.length >= 3 ? slope(paceLaps.map(r => ({x: r.lap, y: r.timeMs}))) : null,
          laps: paceLaps.map(r => ({lap: r.lap, ms: r.timeMs})),
        }
      : null;

    // interval trend to the car ahead, only across laps where it was the same car
    let gapTrend = null;
    if (c.gaps.length) {
      const last = c.gaps[c.gaps.length - 1];
      const same = [];
      for (let j = c.gaps.length - 1; j >= 0 && c.gaps[j].aheadIdx === last.aheadIdx && same.length < 4; j--) same.unshift(c.gaps[j]);
      gapTrend = {
        aheadIdx: last.aheadIdx,
        rateMs: same.length >= 2 ? slope(same.map(s => ({x: s.lap, y: s.gapMs}))) : null,
      };
    }

    return {
      wear: c.live && c.live.wear,
      wearRate,
      stintLaps: c.wearSamples.length,
      pace,
      gapTrend,
    };
  }

  pitLoss() {
    return this.pitLosses.length ? {ms: median(this.pitLosses), samples: this.pitLosses.length} : null;
  }
}

module.exports = {StrategyTracker, slope, median};

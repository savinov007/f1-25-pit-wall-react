const $ = id => document.getElementById(id);
const {
  WEATHER, ERS_MODES, COMPOUNDS, TYRES, CAR_PARTS, DMG_KEYS, DMG_COLORS, TRACK_BUCKET_M,
  tempColor, wearColor, dmgLevel, cap, fmtTime, fmtSector, fmtGap, esc, fmtClock, gapOk, leaderGap,
  learnTrack, recordLapTrace, nearest, metricValue, fmtMetric, fmtDelta,
  tyreProjection, fmtLaps, lapsColor, fmtS, fmtRate, nameOf, rejoinEstimate, battleTrend,
  ersModeName, zoneRanges, boostBadge, aeroLabel, lapTag,
} = PitLib;
const ERS_MAX = 4000000;
const TRACE_SECONDS = 10;
const DISPLAY_FONT = '"Saira Condensed", "Arial Narrow", sans-serif';

// Element ids for the main dashboard ('fuel') and the driver modal ('dmFuel')
const idFor = (prefix, name) => $(prefix ? prefix + cap(name) : name);


// Rev lights: 15 LEDs (green, red, blue)
const rev = $('rev');
for (let i = 0; i < 15; i++) {
  const el = document.createElement('i');
  el.className = i < 5 ? 'g' : i < 10 ? 'r' : 'b';
  rev.appendChild(el);
}

// --- Car diagram: top-down chassis, tyres coloured by temperature, tread drains with wear ---
let carSeq = 0;

function createCar(box) {
  const id = `car${carSeq++}`;
  const info = TYRES.map(ty => `
    <div class="ti ${ty.area} ${ty.side}">
      <div class="ti-top"><span class="ti-name">${ty.n}</span><span class="ti-wear"><b>–</b><small>%</small><em>WEAR</em></span></div>
      <div class="ti-meter"><i></i></div>
      <dl class="ti-stats">
        <div><dt>SURF</dt><dd>–</dd></div><div><dt>INNER</dt><dd>–</dd></div>
        <div><dt>PSI</dt><dd>–</dd></div><div><dt>BRAKE</dt><dd>–</dd></div>
      </dl>
    </div>`).join('');
  const clips = TYRES.map((ty, k) =>
    `<clipPath id="${id}-c${k}"><rect x="${ty.x}" y="${ty.y}" width="${ty.w}" height="${ty.h}" rx="5"/></clipPath>`).join('');
  const tyres = TYRES.map((ty, k) => `
    <g clip-path="url(#${id}-c${k})">
      <rect class="tread" x="${ty.x}" y="${ty.y}" width="${ty.w}" height="${ty.h}" fill="#2a2f40"/>
      <rect class="worn" x="${ty.x}" y="${ty.y}" width="${ty.w}" height="0" fill="url(#${id}-worn)"/>
    </g>
    <rect class="rim" x="${ty.x}" y="${ty.y}" width="${ty.w}" height="${ty.h}" rx="5" stroke="#363c50"/>`).join('');
  box.innerHTML = `<div class="carw">${info}
    <svg class="carsvg" viewBox="0 0 100 200" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <pattern id="${id}-worn" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" fill="#0a0b10"/><rect width="1.6" height="5" fill="#232836"/>
        </pattern>
        ${clips}
      </defs>
      <g class="susp">
        <line x1="24" y1="38" x2="46" y2="34"/><line x1="24" y1="58" x2="46" y2="60"/>
        <line x1="76" y1="38" x2="54" y2="34"/><line x1="76" y1="58" x2="54" y2="60"/>
        <line x1="25" y1="142" x2="36" y2="138"/><line x1="25" y1="162" x2="36" y2="164"/>
        <line x1="75" y1="142" x2="64" y2="138"/><line x1="75" y1="162" x2="64" y2="164"/>
      </g>
      <path class="part floor" d="M40 64 L60 64 L74 92 L74 150 L66 172 L34 172 L26 150 L26 92 Z"/>
      <rect class="part spl" x="27" y="86" width="11" height="48" rx="4"/>
      <rect class="part spr" x="62" y="86" width="11" height="48" rx="4"/>
      <path class="part body" d="M46 16 L54 16 L57 58 L63 72 L66 118 L61 168 L39 168 L34 118 L37 72 L43 58 Z"/>
      <ellipse cx="50" cy="96" rx="6" ry="12" fill="#07080b" stroke="#363c50" stroke-width=".8"/>
      <rect class="part fwl" x="4" y="6" width="45" height="10" rx="2"/>
      <rect class="part fwr" x="51" y="6" width="45" height="10" rx="2"/>
      <rect class="part dif" x="34" y="170" width="32" height="6" rx="1.5"/>
      <rect class="part rw" x="18" y="180" width="64" height="12" rx="2"/>
      ${tyres}
    </svg></div>`;

  const ti = [...box.querySelectorAll('.ti')].map(el => ({
    wear: el.querySelector('.ti-wear'), wearNum: el.querySelector('.ti-wear b'),
    bar: el.querySelector('.ti-meter i'), dd: el.querySelectorAll('dd'),
  }));
  const tread = box.querySelectorAll('.tread'), worn = box.querySelectorAll('.worn'), rim = box.querySelectorAll('.rim');
  const parts = Object.fromEntries(CAR_PARTS.map(([cls]) => [cls, box.querySelector('.' + cls)]));

  return {
    update(t, dmg) {
      TYRES.forEach((ty, k) => {
        const el = ti[k];
        if (t) {
          const temp = t.m_tyresSurfaceTemperature[ty.i], col = tempColor(temp);
          tread[k].setAttribute('fill', col);
          rim[k].setAttribute('stroke', col);
          el.dd[0].textContent = Math.round(temp) + '°';
          el.dd[0].style.color = col;
          el.dd[1].textContent = Math.round(t.m_tyresInnerTemperature[ty.i]) + '°';
          el.dd[2].textContent = t.m_tyresPressure[ty.i].toFixed(1);
          const brake = t.m_brakesTemperature && t.m_brakesTemperature[ty.i];
          el.dd[3].textContent = brake == null ? '–' : Math.round(brake) + '°';
        }
        if (dmg && dmg.m_tyresWear) {
          const w = Math.max(0, Math.min(100, dmg.m_tyresWear[ty.i])), col = wearColor(w);
          worn[k].setAttribute('height', (ty.h * w) / 100);
          el.wearNum.textContent = Math.round(w);
          el.wear.style.color = col;
          el.bar.style.width = w + '%';
          el.bar.style.background = col;
        }
      });
      if (dmg) {
        for (const [cls, key] of CAR_PARTS) parts[cls].style.fill = DMG_COLORS[dmgLevel(dmg[key] || 0)];
      }
    },
  };
}

// --- Damage tiles ---
function createDamage(box) {
  box.innerHTML = DMG_KEYS.map(([, label]) =>
    `<div class="dc"><span>${label}</span><b>0<small>%</small></b><i class="dbar"><i></i></i></div>`).join('');
  const cells = [...box.children].map(el => ({el, num: el.querySelector('b').firstChild, bar: el.querySelector('.dbar i')}));
  return {
    update(d) {
      DMG_KEYS.forEach(([key], i) => {
        const v = Math.round(d[key] || 0), c = cells[i];
        c.el.className = 'dc l' + dmgLevel(v);
        c.num.textContent = v;
        c.bar.style.width = Math.min(100, v) + '%';
      });
    },
  };
}

const mainCar = createCar($('tyregrid'));
const mainDamage = createDamage($('dmg'));

// --- Shared renderers for the dashboard and the driver modal ---
// DRS badge (or overtake mode for 2026 cars), plus the active aero badge when there is one
function renderBadges(drs, aero, t, t2, status) {
  const badge = boostBadge(t, t2, status);
  drs.textContent = badge.label;
  drs.title = badge.wait ? `Overtake mode available in ${badge.wait} m` : '';
  drs.classList.toggle('on', badge.on);
  drs.classList.toggle('avail', badge.avail);
  if (!aero) return;
  const label = aeroLabel(t2);
  aero.hidden = !label;
  if (label) {
    aero.textContent = label;
    aero.classList.toggle('on', label === 'STRAIGHT');
  }
}

function renderDriving(t, prefix, trail, t2, status) {
  idFor(prefix, 'speed').textContent = t.m_speed;
  idFor(prefix, 'gear').textContent = t.m_gear === 0 ? 'N' : t.m_gear < 0 ? 'R' : t.m_gear;
  idFor(prefix, 'rpm').textContent = t.m_engineRPM;
  renderBadges(idFor(prefix, 'drs'), idFor(prefix, 'aero'), t, t2, status);
  idFor(prefix, 'thr').style.height = t.m_throttle * 100 + '%';
  idFor(prefix, 'brk').style.height = t.m_brake * 100 + '%';
  idFor(prefix, 'steer').style.left = 50 + t.m_steer * 45 + '%';
  const now = performance.now();
  trail.push({t: now, thr: t.m_throttle, brk: t.m_brake});
  while (trail.length && now - trail[0].t > TRACE_SECONDS * 1000) trail.shift();
}

// ERS mode label, with the 2026 harvest limit per lap when the game sends one
const ersModeText = (st, format) =>
  ersModeName(st.m_ersDeployMode, format) + (st.m_ersHarvestedLimitPerLap > 0 ? ` · ${(st.m_ersHarvestedLimitPerLap / 1e6).toFixed(1)} MJ/lap` : '');

function renderStatus(st, prefix, format) {
  const [name, color] = COMPOUNDS[st.m_visualTyreCompound] || ['–', '#888'];
  idFor(prefix, 'cname').textContent = name;
  idFor(prefix, 'cdot').style.borderColor = color;
  idFor(prefix, 'cage').textContent = st.m_tyresAgeLaps + (st.m_tyresAgeLaps === 1 ? ' lap' : ' laps');
  const fuelPct = st.m_fuelCapacity ? (st.m_fuelInTank / st.m_fuelCapacity) * 100 : 0;
  idFor(prefix, 'fuel').style.width = Math.max(0, Math.min(100, fuelPct)) + '%';
  idFor(prefix, 'fuelTxt').textContent = st.m_fuelInTank.toFixed(1) + ' KG';
  const laps = st.m_fuelRemainingLaps;
  idFor(prefix, 'fuelLaps').textContent = laps == null ? '' : `${laps >= 0 ? '+' : ''}${laps.toFixed(2)} laps`;
  const ersPct = (st.m_ersStoreEnergy / ERS_MAX) * 100;
  idFor(prefix, 'ers').style.width = Math.max(0, Math.min(100, ersPct)) + '%';
  idFor(prefix, 'ersTxt').textContent = Math.round(ersPct) + '%';
  idFor(prefix, 'ersMode').textContent = ersModeText(st, format);
}

// --- Rolling pedal traces ---
function drawPedalTrace(cv, trail) {
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  const ctx = cv.getContext('2d'), dpr = devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = w * dpr; cv.height = h * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = '#161923'; ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, Math.round((h * i) / 4) + .5); ctx.lineTo(w, Math.round((h * i) / 4) + .5); ctx.stroke(); }
  const now = performance.now(), span = TRACE_SECONDS * 1000;
  const series = (key, rgb) => {
    const pts = trail.map(s => [w - ((now - s.t) / span) * w, h - 3 - s[key] * (h - 6)]);
    if (pts.length < 2) return;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, `rgba(${rgb}, .32)`); grad.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.beginPath(); ctx.moveTo(pts[0][0], h);
    for (const [x, y] of pts) ctx.lineTo(x, y);
    ctx.lineTo(pts[pts.length - 1][0], h); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.strokeStyle = `rgb(${rgb})`; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
  };
  series('thr', '31, 209, 102');
  series('brk', '255, 45, 31');
}
const samples = [];

// --- Track map ---
const map = $('map'), mctx = map.getContext('2d');
let track = new Map(), sessionUID = null, car = null;

function drawMap() {
  const dpr = devicePixelRatio || 1;
  const w = map.clientWidth, h = map.clientHeight;
  if (!w || !h) return;
  if (map.width !== Math.round(w * dpr) || map.height !== Math.round(h * dpr)) { map.width = w * dpr; map.height = h * dpr; }
  mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  mctx.clearRect(0, 0, w, h);
  const rivals = ((latest && latest.rivals) || []).filter(r => !r.player && (r.x || r.z));
  const keys = [...track.keys()].sort((a, b) => a - b);
  const pts = [...keys.map(k => track.get(k)), ...rivals, ...(car ? [car] : [])];
  if (pts.length < 2) {
    mctx.fillStyle = '#7a8195'; mctx.textAlign = 'center';
    mctx.font = `600 12px ${DISPLAY_FONT}`;
    mctx.fillText('WAITING FOR CARS ON TRACK', w / 2, h / 2);
    return;
  }
  const b = pts.reduce(
    (acc, p) => ({minX: Math.min(acc.minX, p.x), maxX: Math.max(acc.maxX, p.x), minZ: Math.min(acc.minZ, p.z), maxZ: Math.max(acc.maxZ, p.z)}),
    {minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity}
  );
  const pad = 22, spanX = b.maxX - b.minX || 1, spanZ = b.maxZ - b.minZ || 1;
  const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanZ);
  const ox = (w - spanX * scale) / 2, oy = (h - spanZ * scale) / 2;
  const px = p => ox + (p.x - b.minX) * scale, py = p => oy + (p.z - b.minZ) * scale;

  // outline: connect consecutive buckets, break the line across gaps not yet driven
  if (keys.length > 1) {
    mctx.lineJoin = 'round'; mctx.lineCap = 'round';
    mctx.beginPath();
    keys.forEach((k, i) => {
      const p = track.get(k);
      if (i && k - keys[i - 1] <= 4) mctx.lineTo(px(p), py(p)); else mctx.moveTo(px(p), py(p));
    });
    const first = track.get(keys[0]), last = track.get(keys[keys.length - 1]);
    if (Math.hypot(first.x - last.x, first.z - last.z) < TRACK_BUCKET_M * 6) mctx.lineTo(px(first), py(first));
    mctx.strokeStyle = '#1c2030'; mctx.lineWidth = 12; mctx.stroke();
    mctx.strokeStyle = '#2b3042'; mctx.lineWidth = 8; mctx.stroke();
    mctx.strokeStyle = 'rgba(225, 6, 0, .75)'; mctx.lineWidth = 1.5; mctx.stroke();
  }

  // 2026: active aero zones (cyan) and DRS zones (green) along the learned outline
  const se = latest && latest.session;
  const drawZones = (ranges, color) => {
    if (!ranges.length) return;
    mctx.strokeStyle = color; mctx.lineWidth = 4;
    for (const [from, to] of ranges) {
      mctx.beginPath();
      let prev = null;
      for (const k of keys) {
        const d = k * TRACK_BUCKET_M;
        if (d < from || d > to) { prev = null; continue; }
        const p = track.get(k);
        if (prev !== null && k - prev <= 4) mctx.lineTo(px(p), py(p)); else mctx.moveTo(px(p), py(p));
        prev = k;
      }
      mctx.stroke();
    }
  };
  if (se && keys.length > 1) {
    drawZones(zoneRanges(se.aeroZones, se.trackLength), 'rgba(51, 214, 232, .9)');
    drawZones(zoneRanges(se.drsZones, se.trackLength), 'rgba(31, 209, 102, .9)');
  }

  mctx.font = `700 11px ${DISPLAY_FONT}`; mctx.textAlign = 'center';
  for (const r of rivals) {
    const x = px(r), y = py(r);
    mctx.globalAlpha = r.result > 3 ? 0.35 : r.pit ? 0.6 : 1;
    mctx.beginPath(); mctx.arc(x, y, 5.5, 0, Math.PI * 2);
    mctx.fillStyle = r.color; mctx.fill();
    mctx.lineWidth = 2; mctx.strokeStyle = '#07080b'; mctx.stroke();
    mctx.lineWidth = 3; mctx.strokeStyle = 'rgba(7, 8, 11, .85)';
    const label = r.name.slice(0, 3).toUpperCase();
    mctx.strokeText(label, x, y - 10);
    mctx.fillStyle = '#eceef3'; mctx.fillText(label, x, y - 10);
    mctx.globalAlpha = 1;
  }
  if (car) {
    mctx.beginPath(); mctx.arc(px(car), py(car), 7, 0, Math.PI * 2);
    mctx.fillStyle = '#fff'; mctx.shadowColor = '#fff'; mctx.shadowBlur = 14; mctx.fill(); mctx.shadowBlur = 0;
    mctx.lineWidth = 2.5; mctx.strokeStyle = '#e10600'; mctx.stroke();
  }
}

let bestLap = 0, lastSeenLast = 0;

// the game's UDP format, chosen on the waiting screen and remembered ('2025' | '2026' | null = not chosen yet)
let chosenFormat = null;
try { const v = localStorage.getItem('pitwall-format'); if (v === '2025' || v === '2026') chosenFormat = v; } catch (err) { /* ask again */ }
function syncFormatPick() {
  document.querySelectorAll('#fmtPick button').forEach(b => b.classList.toggle('on', b.dataset.format === chosenFormat));
  $('fmtPick').classList.toggle('need', !chosenFormat);
  $('setupHint').hidden = $('setupList').hidden = !chosenFormat;
  if (chosenFormat) $('waitFormat').textContent = chosenFormat + (chosenFormat === '2026' ? ' (F1 26)' : ' (F1 25)');
}
document.querySelectorAll('#fmtPick button').forEach(b => {
  b.onclick = () => {
    chosenFormat = b.dataset.format;
    try { localStorage.setItem('pitwall-format', chosenFormat); } catch (err) { /* not persisted */ }
    syncFormatPick();
  };
});
syncFormatPick();
// tell the player when the game sends a different format than the one they picked (once per mismatch)
let warnedFormat = null;
function checkFormat(format) {
  if (!chosenFormat || !format || String(format) === chosenFormat || warnedFormat === format) return;
  warnedFormat = format;
  showToast(`The game is sending UDP format <b>${format}</b>, not ${chosenFormat}. Showing ${format} data.`, 8000);
}

function renderWait(s) {
  const box = $('wait');
  box.hidden = s.hasData || !s.setup || !!s.replay;
  if (box.hidden) return;
  const ips = s.setup.ips;
  $('waitIp').textContent = ips.length ? ips[0].address : 'no network found';
  $('waitPort').textContent = s.setup.udpPort;
  $('waitAlt').textContent = ips.length > 1
    ? 'Other addresses: ' + ips.slice(1).map(i => `${i.address} (${i.name})`).join(', ')
    : '';
}

// --- Standings ---
let gapMode = 'interval';
$('gapMode').onclick = () => {
  gapMode = gapMode === 'interval' ? 'leader' : 'interval';
  $('gapMode').textContent = gapMode.toUpperCase();
  if (latest) renderRivals(latest);
};

let lapMode = 'last';
try { if (localStorage.getItem('pitwall-lapmode') === 'best') lapMode = 'best'; } catch (err) { /* default */ }
function syncLapMode() {
  $('lapMode').textContent = lapMode.toUpperCase();
  // in BEST mode the gap column is the delta to the fastest lap, so interval/leader doesn't apply
  $('gapHead').textContent = lapMode === 'best' ? 'Δ BEST' : 'GAP';
  $('gapMode').disabled = lapMode === 'best';
  $('gapMode').title = lapMode === 'best' ? 'Gap shows the delta to the fastest lap while BEST is selected' : 'Toggle gap type';
}
syncLapMode();
$('lapMode').onclick = () => {
  lapMode = lapMode === 'last' ? 'best' : 'last';
  syncLapMode();
  try { localStorage.setItem('pitwall-lapmode', lapMode); } catch (err) { /* not persisted */ }
  if (latest) renderRivals(latest);
};

const lapTagHtml = status => {
  const t = lapTag(status);
  return t ? `<span class="tag ${t.cls}" title="${t.title}">${t.label}</span>` : '';
};

let lastRowsHtml = '';
function renderRivals(s) {
  const rows = $('rows');
  if (!s.rivals || !s.rivals.length) { rows.innerHTML = '<div class="empty">No rivals yet</div>'; lastRowsHtml = ''; return; }
  const bests = s.rivals.map(r => r.best).filter(b => b > 0);
  const fastest = bests.length ? Math.min(...bests) : 0;
  const html = s.rivals.map(r => {
    const first = r.pos === 1;
    const out = r.result > 3; // finished is 3; 4+ = DNF / DSQ / retired
    const best = lapMode === 'best';
    const gap = gapMode === 'interval' ? r.gapFront : r.gapLeader;
    const gapText = out ? 'OUT'
      : best ? (!r.best || !fastest ? '–' : r.best === fastest ? 'FASTEST' : '+' + ((r.best - fastest) / 1000).toFixed(3))
      : fmtGap(gap, first);
    const [cname, ccolor] = COMPOUNDS[r.compound] || ['–', '#888'];
    return `<div class="srow${r.player ? ' me' : ''}${out ? ' out' : ''}" data-idx="${r.idx}">
      <span class="p">${r.pos}</span><span class="team" style="background:${esc(r.color)}"></span>
      <span class="n" title="${esc(r.team)}">${esc(r.name)}${r.human && !r.telemetryPublic ? `<small>#${r.num}</small>` : ''}${r.pit ? '<span class="tag pit">PIT</span>' : ''}${lapTagHtml(r.driverStatus)}${r.overtake ? '<span class="tag ot" title="Overtake mode in use">OT</span>' : ''}${r.wrongWay ? '<span class="tag ww">WRONG WAY</span>' : ''}${r.penalty ? `<span class="tag pen">+${r.penalty}s</span>` : ''}</span>
      <span class="g">${gapText}</span><span class="l${best && r.best && r.best === fastest ? ' fastest' : ''}">${fmtTime(best ? r.best : r.last)}</span>
      <span class="t"><i style="border-color:${ccolor}" title="${cname}"></i>${r.age}</span></div>`;
  }).join('');
  if (html !== lastRowsHtml) { rows.innerHTML = html; lastRowsHtml = html; }
}

// --- Driver detail modal ---
let selected = null;
let ws = null;
const dm = $('dm');
const dmSamples = [];
const dmCar = createCar($('dmTyres'));
const dmDamage = createDamage($('dmDmg'));

function sendSelect() {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({select: selected}));
}
function openDriver(idx) {
  selected = idx;
  dmSamples.length = 0;
  dm.hidden = false;
  sendSelect();
  if (latest) renderDriver(latest);
}
function closeDriver() {
  selected = null;
  dm.hidden = true;
  sendSelect();
}
// pointerdown, not click: the board re-renders ~30x/s and would swallow a click between down and up
$('rows').addEventListener('pointerdown', e => {
  const row = e.target.closest('.srow');
  if (row) openDriver(Number(row.dataset.idx));
});
$('dmClose').onclick = closeDriver;
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !dm.hidden) closeDriver(); });

function renderDriver(s) {
  if (dm.hidden) return;
  const r = (s.rivals || []).find(x => x.idx === selected);
  if (r) {
    $('dmPos').textContent = r.pos;
    $('dmName').textContent = r.name;
    $('dmTeam').textContent = `#${r.num}${r.team ? ' · ' + r.team : ''}`;
    $('dmBar').style.background = r.color;
    $('dmLap').textContent = r.lapNum + (s.session && s.session.totalLaps ? ' / ' + s.session.totalLaps : '');
    $('dmStops').textContent = r.stops;
    setHtml($('dmStrat'), stratMini(r));
  }
  const d = s.detail;
  const note = $('dmNote');
  if (!d || d.idx !== selected || !d.telemetry) { note.hidden = false; note.textContent = 'Waiting for this car\'s data…'; return; }
  const t = d.telemetry;
  const restricted = r && !r.telemetryPublic && !r.player && !t.m_speed && !t.m_engineRPM;
  note.hidden = !restricted;
  if (restricted) note.textContent = 'This driver\'s telemetry is set to Restricted, so the game sends empty values for them.';

  renderDriving(t, 'dm', dmSamples, d.telemetry2, d.status);
  if (d.status) renderStatus(d.status, 'dm', s.session && s.session.packetFormat);
  dmCar.update(t, d.damage);
  if (d.damage) dmDamage.update(d.damage);
  const l = d.lap;
  if (l) {
    $('dmCur').textContent = fmtTime(l.m_currentLapTimeInMS);
    $('dmLast').textContent = fmtTime(l.m_lastLapTimeInMS);
    $('dmS1').textContent = fmtSector(l.m_sector1TimeInMS ?? l.m_sector1TimeMSPart);
    $('dmS2').textContent = fmtSector(l.m_sector2TimeInMS ?? l.m_sector2TimeMSPart);
  }
}

// --- Recording ---
let wasRecording = false, toastTimer = null;
function showToast(html, ms = 12000) {
  const el = $('toast');
  el.innerHTML = html;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function renderRecording(s) {
  const r = s.recording;
  const btn = $('rec');
  if (!r) return;
  btn.disabled = !r.available;
  btn.classList.toggle('on', r.active);
  btn.title = r.available ? 'Record raw game packets to a file' : 'Recording needs live game data (not available in demo mode)';
  $('recText').textContent = r.active ? `${fmtClock(r.seconds)} · ${r.packets.toLocaleString()} pkts` : 'REC';
  if (wasRecording && !r.active && r.lastFile) {
    showToast(`Saved <code>${esc(r.lastFile)}</code> · ${(r.lastBytes / 1048576).toFixed(1)} MB · ${r.lastPackets.toLocaleString()} packets<br>Replay: <code>npm run replay -- ${esc(r.lastFile)}</code>`);
  }
  wasRecording = r.active;
}
$('rec').onclick = () => {
  if (ws && ws.readyState === 1 && latest && latest.recording) ws.send(JSON.stringify({record: !latest.recording.active}));
};

// --- Compare mode: up to 4 drivers side by side, plus one overlaid trace chart ---
const SLOT_COLORS = ['#ff2d1f', '#3aa0ff', '#ffb020', '#1fd166'];
const CMP_SECONDS = 20;
const cmp = $('cmp');
let cmpSel = [];
let cmpMetric = 'speed';
let cmpPickHtml = '';
const cmpTrails = new Map(); // car idx -> [{t, speed, thr, brk, gear}]
let cmpCols = []; // per slot: {idx, el, refs}

function sendCompare() {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({compare: cmp.hidden ? [] : cmpSel}));
}
function openCompare(withIdx) {
  if (!dm.hidden) closeDriver();
  if (!cmpSel.length && latest && latest.rivals) {
    // sensible default: you, plus the driver you opened it from or the car directly ahead (or the leader)
    const me = latest.rivals.find(r => r.player);
    const ahead = me && latest.rivals.find(r => r.pos === me.pos - 1);
    const other = withIdx != null ? null : ahead || latest.rivals[0];
    cmpSel = [me, other].filter(Boolean).map(r => r.idx).filter((v, i, a) => a.indexOf(v) === i);
  }
  if (withIdx != null && !cmpSel.includes(withIdx)) cmpSel = [...cmpSel.slice(0, 3), withIdx];
  cmp.hidden = false;
  cmpPickHtml = '';
  buildCompareCols();
  sendCompare();
  if (latest) renderCompare(latest);
}
function closeCompare() {
  cmp.hidden = true;
  sendCompare();
}
function toggleCompare(idx) {
  if (cmpSel.includes(idx)) cmpSel = cmpSel.filter(i => i !== idx);
  else if (cmpSel.length < 4) cmpSel = [...cmpSel, idx];
  cmpPickHtml = '';
  buildCompareCols();
  sendCompare();
  if (latest) renderCompare(latest);
}
$('compareBtn').onclick = () => openCompare();
$('compareBtn2').onclick = () => openCompare();
$('dmCompare').onclick = () => openCompare(selected);
$('cmpClose').onclick = closeCompare;
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !cmp.hidden) closeCompare(); });
$('cmpPick').addEventListener('pointerdown', e => {
  const chip = e.target.closest('.pchip');
  if (chip && !chip.disabled) toggleCompare(Number(chip.dataset.idx));
});
$('cmpCols').addEventListener('click', e => {
  const x = e.target.closest('.ccx');
  if (x) toggleCompare(Number(x.dataset.idx));
});
$('cmpMetric').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  cmpMetric = b.dataset.m;
  for (const btn of $('cmpMetric').children) btn.classList.toggle('on', btn === b);
});

// Lap-synced traces: per car, samples keyed by lap distance for the current and last completed lap
let cmpAxis = 'time', cmpLapView = 'cur', cmpHoverX = null;
const lapTraces = new Map(); // idx -> {lap, cur: [{d, speed, thr, brk, gear}], last: [...], lastLap}
function setTabs(id, attr, value) {
  for (const btn of $(id).children) btn.classList.toggle('on', btn.dataset[attr] === value);
}
$('cmpAxis').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  cmpAxis = b.dataset.a;
  setTabs('cmpAxis', 'a', cmpAxis);
  $('cmpLap').hidden = cmpAxis !== 'dist';
  $('cmpChartLbl').textContent = cmpAxis === 'dist' ? 'Lap-synced trace · by distance' : 'Live trace · last 20 s';
});
$('cmpLap').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  cmpLapView = b.dataset.l;
  setTabs('cmpLap', 'l', cmpLapView);
});
$('cmpCanvas').addEventListener('pointermove', e => { cmpHoverX = e.offsetX; });
$('cmpCanvas').addEventListener('pointerleave', () => { cmpHoverX = null; });

function renderPicker(s) {
  const rivals = s.rivals || [];
  const html = rivals.map(r => {
    const slot = cmpSel.indexOf(r.idx);
    const full = slot < 0 && cmpSel.length >= 4;
    return `<button class="pchip${slot >= 0 ? ' on' : ''}" data-idx="${r.idx}" ${full ? 'disabled' : ''}
      style="--team:${esc(r.color)};${slot >= 0 ? `--slot:${SLOT_COLORS[slot]}` : ''}"><i></i><b>${r.pos}</b>${esc(r.name.slice(0, 14))}${r.player ? ' <em>YOU</em>' : ''}</button>`;
  }).join('');
  if (html !== cmpPickHtml) { $('cmpPick').innerHTML = html || '<span class="lbl">No drivers yet</span>'; cmpPickHtml = html; }
}

function buildCompareCols() {
  const box = $('cmpCols');
  box.style.setProperty('--n', Math.max(1, cmpSel.length));
  if (!cmpSel.length) {
    box.innerHTML = '<div class="cmpempty">Pick drivers above to compare their telemetry</div>';
    cmpCols = [];
    return;
  }
  box.innerHTML = '';
  cmpCols = cmpSel.map((idx, k) => {
    const el = document.createElement('div');
    el.className = 'cc';
    el.style.setProperty('--slot', SLOT_COLORS[k]);
    el.innerHTML = `
      <div class="cchead"><i class="ccslot"></i><span class="ccteam"></span>
        <span class="ccpos">P<b>–</b></span><div class="ccwho"><b class="ccname">–</b><small class="ccsub"></small></div>
        <button class="ccx" data-idx="${idx}" title="Remove from comparison">✕</button></div>
      <div class="ccnote" hidden></div>
      <div class="ccspeed">
        <div><div class="lbl">GEAR</div><b class="ccgear">N</b></div>
        <div class="big"><b class="ccspd">0</b><div class="lbl">KM/H</div></div>
        <div><div class="lbl">RPM</div><b class="ccrpm">0</b><div class="drs ccdrs">DRS</div></div>
      </div>
      <div class="ccpedals">
        <div class="hb"><span>THR</span><div class="hbar"><i class="ccthr thr"></i></div><b class="ccthrv">0%</b></div>
        <div class="hb"><span>BRK</span><div class="hbar"><i class="ccbrk brk"></i></div><b class="ccbrkv">0%</b></div>
      </div>
      <dl class="ccstats">
        <div><dt>GAP TO LEADER</dt><dd class="ccgap">–</dd></div>
        <div><dt class="ccvsl">VS –</dt><dd class="ccvs">–</dd></div>
        <div><dt>CURRENT</dt><dd class="cccur">–</dd></div>
        <div><dt>LAST LAP</dt><dd class="cclast">–</dd></div>
        <div><dt>BEST LAP</dt><dd class="ccbest">–</dd></div>
        <div><dt>LAP · STOPS</dt><dd class="cclap">–</dd></div>
      </dl>
      <div class="stratline ccstrat"></div>
      <div class="cctyrehead"><span class="lbl">TYRES &amp; CAR</span><span class="compound"><span class="cdot cccdot"></span><b class="cccname">–</b><small class="cccage"></small></span></div>
      <div class="tyrebox cctyrebox"></div>
      <div class="meters ccmeters">
        <div class="meter"><div class="mhead"><span>FUEL</span><b class="ccfuel">–</b><small class="ccfuell"></small></div><div class="seg"><i class="fuel ccfuelb"></i></div></div>
        <div class="meter"><div class="mhead"><span>ERS</span><b class="ccers">–</b><small class="ccersm"></small></div><div class="seg"><i class="ers ccersb"></i></div></div>
      </div>
      <div class="dmg ccdmgbox"></div>`;
    box.appendChild(el);
    const q = c => el.querySelector('.' + c);
    const refs = {};
    for (const c of ['ccpos', 'ccname', 'ccsub', 'ccteam', 'ccnote', 'ccgear', 'ccspd', 'ccrpm', 'ccdrs', 'ccthr', 'ccthrv', 'ccbrk', 'ccbrkv',
      'ccgap', 'ccvsl', 'ccvs', 'cccur', 'cclast', 'ccbest', 'cclap', 'cccdot', 'cccname', 'cccage', 'ccfuel', 'ccfuell', 'ccfuelb',
      'ccers', 'ccersm', 'ccersb', 'ccstrat']) refs[c] = q(c);
    return {idx, el, refs, car: createCar(q('cctyrebox')), damage: createDamage(q('ccdmgbox'))};
  });
}

function renderCompare(s) {
  if (cmp.hidden) return;
  renderPicker(s);
  const rivals = s.rivals || [];
  const byIdx = new Map(rivals.map(r => [r.idx, r]));
  const details = new Map((s.compare || []).map(d => [d.idx, d]));
  const now = performance.now();

  // trails for the chart
  for (const d of details.values()) {
    if (!d.telemetry) continue;
    const trail = cmpTrails.get(d.idx) || [];
    const t = d.telemetry;
    trail.push({t: now, speed: t.m_speed, thr: t.m_throttle, brk: t.m_brake, gear: t.m_gear});
    while (trail.length && now - trail[0].t > CMP_SECONDS * 1000) trail.shift();
    cmpTrails.set(d.idx, trail);
    if (d.lap) recordLapTrace(lapTraces, d.idx, t, d.lap);
  }

  // best values across the compared drivers get highlighted
  const sel = cmpCols.map(c => byIdx.get(c.idx)).filter(Boolean);
  const minOf = vals => { const v = vals.filter(x => x > 0); return v.length > 1 ? Math.min(...v) : 0; };
  const bestLast = minOf(sel.map(r => r.last)), bestBest = minOf(sel.map(r => r.best));
  const ref = byIdx.get(cmpCols[0] && cmpCols[0].idx);

  cmpCols.forEach((col, k) => {
    const r = byIdx.get(col.idx), d = details.get(col.idx), f = col.refs;
    if (r) {
      f.ccpos.querySelector('b').textContent = r.pos;
      f.ccname.textContent = r.name;
      f.ccsub.textContent = `#${r.num}${r.team ? ' · ' + r.team : ''}${r.pit ? ' · IN PIT' : ''}`;
      f.ccteam.style.background = r.color;
      f.ccgap.textContent = r.pos === 1 ? 'LEADER' : gapOk(r.gapLeader) && r.gapLeader ? '+' + (r.gapLeader / 1000).toFixed(3) : '–';
      if (k === 0 || !ref) { f.ccvsl.textContent = 'REFERENCE'; f.ccvs.textContent = '—'; f.ccvs.className = 'ccvs'; }
      else {
        f.ccvsl.textContent = 'VS ' + ref.name.slice(0, 10).toUpperCase();
        const a = leaderGap(r), b = leaderGap(ref);
        const delta = a == null || b == null ? null : a - b;
        f.ccvs.textContent = delta == null ? '–' : (delta >= 0 ? '+' : '−') + Math.abs(delta / 1000).toFixed(3);
        f.ccvs.className = 'ccvs ' + (delta == null ? '' : delta > 0 ? 'behind' : 'ahead');
      }
      f.cclast.textContent = fmtTime(r.last);
      f.cclast.classList.toggle('purple', !!bestLast && r.last === bestLast);
      f.ccbest.textContent = fmtTime(r.best);
      f.ccbest.classList.toggle('purple', !!bestBest && r.best === bestBest);
      f.cclap.textContent = `${r.lapNum || '–'} · ${r.stops}`;
      setHtml(f.ccstrat, stratMini(r));
    }
    if (!d || !d.telemetry) { f.ccnote.hidden = false; f.ccnote.textContent = 'Waiting for this car\'s data…'; return; }
    const t = d.telemetry;
    const restricted = r && !r.telemetryPublic && !r.player && !t.m_speed && !t.m_engineRPM;
    f.ccnote.hidden = !restricted;
    if (restricted) f.ccnote.textContent = 'Telemetry restricted by this player — the game sends empty values.';
    f.ccspd.textContent = t.m_speed;
    f.ccgear.textContent = t.m_gear === 0 ? 'N' : t.m_gear < 0 ? 'R' : t.m_gear;
    f.ccrpm.textContent = t.m_engineRPM;
    renderBadges(f.ccdrs, null, t, d.telemetry2, d.status);
    f.ccthr.style.width = t.m_throttle * 100 + '%';
    f.ccthrv.textContent = Math.round(t.m_throttle * 100) + '%';
    f.ccbrk.style.width = t.m_brake * 100 + '%';
    f.ccbrkv.textContent = Math.round(t.m_brake * 100) + '%';
    if (d.lap) f.cccur.textContent = fmtTime(d.lap.m_currentLapTimeInMS);
    const st = d.status;
    if (st) {
      const [name, color] = COMPOUNDS[st.m_visualTyreCompound] || ['–', '#888'];
      f.cccname.textContent = name;
      f.cccdot.style.borderColor = color;
      f.cccage.textContent = st.m_tyresAgeLaps + (st.m_tyresAgeLaps === 1 ? ' lap' : ' laps');
      const fuelPct = st.m_fuelCapacity ? (st.m_fuelInTank / st.m_fuelCapacity) * 100 : 0;
      f.ccfuelb.style.width = Math.max(0, Math.min(100, fuelPct)) + '%';
      f.ccfuel.textContent = st.m_fuelInTank.toFixed(1) + ' KG';
      const laps = st.m_fuelRemainingLaps;
      f.ccfuell.textContent = laps == null ? '' : `${laps >= 0 ? '+' : ''}${laps.toFixed(2)} laps`;
      const ersPct = (st.m_ersStoreEnergy / ERS_MAX) * 100;
      f.ccersb.style.width = Math.max(0, Math.min(100, ersPct)) + '%';
      f.ccers.textContent = Math.round(ersPct) + '%';
      f.ccersm.textContent = ersModeText(st, s.session && s.session.packetFormat);
    }
    col.car.update(t, d.damage);
    if (d.damage) col.damage.update(d.damage);
  });
}

function drawCompareChart() {
  const cv = $('cmpCanvas');
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  const ctx = cv.getContext('2d'), dpr = devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = w * dpr; cv.height = h * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const byDist = cmpAxis === 'dist';
  const now = performance.now();

  // series per slot: points sorted by the x field ('t' for time, 'd' for distance)
  const series = cmpCols.map(c => {
    if (!byDist) return cmpTrails.get(c.idx) || [];
    const lt = lapTraces.get(c.idx);
    return lt ? (cmpLapView === 'last' ? lt.last : lt.cur) : [];
  });
  const field = byDist ? 'd' : 't';
  let xMin, xMax;
  if (byDist) {
    let seen = 0;
    for (const pts of series) if (pts.length) seen = Math.max(seen, pts[pts.length - 1].d);
    xMin = 0;
    xMax = (latest && latest.session && latest.session.trackLength) || Math.max(seen, 1000);
  } else {
    xMax = now; xMin = now - CMP_SECONDS * 1000;
  }

  let max = cmpMetric === 'speed' ? 350 : cmpMetric === 'gear' ? 8 : 1;
  if (cmpMetric === 'speed') for (const pts of series) for (const p of pts) max = Math.max(max, p.speed);
  const padL = 44, padR = 8, padT = 8, padB = 18, plotW = w - padL - padR, plotH = h - padT - padB;
  const xOf = v => padL + ((v - xMin) / (xMax - xMin)) * plotW;
  const yOf = v => padT + plotH - (v / max) * plotH;

  // grid + axis labels
  ctx.font = `600 10px ${DISPLAY_FONT}`; ctx.fillStyle = '#7a8195'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.strokeStyle = '#171a24'; ctx.lineWidth = 1;
  const ticks = cmpMetric === 'gear' ? [0, 2, 4, 6, 8] : [0, .25, .5, .75, 1].map(f => f * max);
  for (const v of ticks) {
    const y = Math.round(yOf(v)) + .5;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    ctx.fillText(cmpMetric === 'speed' ? Math.round(v) : cmpMetric === 'gear' ? v : Math.round(v * 100) + '%', padL - 8, y);
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  if (byDist) {
    const step = xMax > 4000 ? 1000 : 500;
    for (let d = 0; d <= xMax; d += step) {
      const x = xOf(d);
      ctx.strokeStyle = '#141720'; ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, padT); ctx.lineTo(Math.round(x) + .5, padT + plotH); ctx.stroke();
      ctx.fillText(d ? (d / 1000).toFixed(d % 1000 ? 1 : 0) + ' km' : 'START', x, h - 4);
    }
  } else {
    for (let sec = 0; sec <= CMP_SECONDS; sec += 5) ctx.fillText(sec ? `-${sec}s` : 'now', xOf(now - sec * 1000), h - 4);
  }

  // traces
  series.forEach((pts, k) => {
    if (pts.length < 2) return;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      // don't join across gaps in the recorded lap (we joined mid-lap, or skipped samples)
      const gap = byDist && i && p.d - pts[i - 1].d > 60;
      const x = xOf(p[field]), y = yOf(metricValue(p, cmpMetric));
      if (!started || gap) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = SLOT_COLORS[k]; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.shadowColor = SLOT_COLORS[k]; ctx.shadowBlur = 6; ctx.stroke(); ctx.shadowBlur = 0;
  });

  if (byDist && series.every(p => p.length < 2)) {
    ctx.fillStyle = '#7a8195'; ctx.textAlign = 'center'; ctx.font = `600 12px ${DISPLAY_FONT}`;
    ctx.fillText(cmpLapView === 'last' ? 'NO COMPLETED LAP RECORDED YET — KEEP COMPARE OPEN FOR A FULL LAP' : 'WAITING FOR CARS TO CROSS THE LINE',
      padL + plotW / 2, padT + plotH / 2);
  }

  // hover crosshair: every driver's value at the same point, with the delta to the reference (first) driver
  if (cmpHoverX == null || cmpHoverX < padL || cmpHoverX > padL + plotW) return;
  const key = xMin + ((cmpHoverX - padL) / plotW) * (xMax - xMin);
  const tolerance = byDist ? 40 : 300; // metres / ms
  const rows = [];
  let refVal = null;
  series.forEach((pts, k) => {
    const p = nearest(pts, field, key);
    const ok = p && Math.abs(p[field] - key) <= tolerance;
    const v = ok ? metricValue(p, cmpMetric) : null;
    if (k === 0) refVal = v;
    const r = latest && latest.rivals && latest.rivals.find(x => x.idx === cmpCols[k].idx);
    rows.push({k, v, name: r ? r.name.slice(0, 12).toUpperCase() : '—', y: v == null ? null : yOf(v)});
  });
  ctx.strokeStyle = 'rgba(236, 238, 243, .35)'; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(cmpHoverX + .5, padT); ctx.lineTo(cmpHoverX + .5, padT + plotH); ctx.stroke();
  ctx.setLineDash([]);
  for (const r of rows) {
    if (r.y == null) continue;
    ctx.beginPath(); ctx.arc(cmpHoverX, r.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = SLOT_COLORS[r.k]; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#07080b'; ctx.stroke();
  }
  // readout box
  const title = byDist ? `${Math.round(key)} m` : `${((now - key) / 1000).toFixed(1)} s ago`;
  ctx.font = `600 11px ${DISPLAY_FONT}`;
  const lineH = 15, boxW = 190, boxH = 10 + lineH * (rows.length + 1);
  let bx = cmpHoverX + 12;
  if (bx + boxW > w - padR) bx = cmpHoverX - 12 - boxW;
  const by = padT + 4;
  ctx.fillStyle = 'rgba(10, 11, 16, .92)'; ctx.strokeStyle = '#2b3042'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 6); ctx.fill(); ctx.stroke();
  ctx.textAlign = 'left'; ctx.fillStyle = '#7a8195';
  ctx.fillText(title, bx + 10, by + 4 + lineH - 3);
  rows.forEach((r, i) => {
    const y = by + 4 + lineH * (i + 2) - 3;
    ctx.fillStyle = SLOT_COLORS[r.k]; ctx.fillRect(bx + 10, y - 8, 3, 10);
    ctx.fillStyle = '#eceef3'; ctx.textAlign = 'left'; ctx.fillText(r.name, bx + 18, y);
    ctx.textAlign = 'right';
    const val = r.v == null ? '–' : fmtMetric(r.v, cmpMetric);
    ctx.fillText(val, bx + boxW - (r.k && refVal != null && r.v != null ? 58 : 10), y);
    if (r.k && refVal != null && r.v != null) {
      const dlt = r.v - refVal;
      ctx.fillStyle = dlt > 0 ? '#1fd166' : dlt < 0 ? '#ff2d1f' : '#7a8195';
      if (cmpMetric === 'brk') ctx.fillStyle = '#7a8195';
      ctx.fillText(fmtDelta(dlt, cmpMetric), bx + boxW - 10, y);
    }
  });
}

// --- Strategy: projections from the server's measured rates ---
let wearLimit = 70;
try { const v = Number(localStorage.getItem('pitwall-wearlimit')); if (v) wearLimit = v; } catch (err) { /* default */ }
$('wearLimit').value = String(wearLimit);
$('wearLimit').onchange = e => {
  wearLimit = Number(e.target.value);
  try { localStorage.setItem('pitwall-wearlimit', String(wearLimit)); } catch (err) { /* not persisted */ }
  if (latest) render(latest);
};
const setHtml = (el, html) => { if (el._html !== html) { el.innerHTML = html; el._html = html; } };

function threatRow(label, other, gapMs, rateMs, chasing) {
  if (!other) return `<div class="sthreat"><span class="dir">${label}</span><span class="none">${chasing ? 'Leading' : 'Nobody behind'}</span></div>`;
  const trend = battleTrend(gapMs, rateMs, chasing);
  const gap = gapOk(gapMs) && gapMs ? (chasing ? '+' : '−') + fmtS(gapMs) + 's' : '–';
  return `<div class="sthreat"><span class="dir">${label}</span><i style="background:${esc(other.color)}"></i><b>${nameOf(other)}</b>
    <span class="sgap">${gap}</span><span class="strend ${trend.cls}">${trend.text}</span></div>`;
}

function renderStrategy(s) {
  const box = $('strat');
  const me = (s.rivals || []).find(r => r.player);
  if (!me) return setHtml(box, '<div class="empty">Waiting for data</div>');
  const st = me.strategy;
  const se = s.session || {};
  const parts = [];

  // tyres
  const tp = tyreProjection(st, wearLimit);
  const [cname] = COMPOUNDS[me.compound] || ['–'];
  let tyres = `<div class="sblk"><div class="shd"><span class="lbl">Tyres</span><small>${cname} · ${me.age} laps old</small></div>`;
  if (tp && tp.worst) {
    const w = tp.worst;
    const boxLap = isFinite(w.left) ? `box ≈ L${me.lapNum + Math.floor(w.left)}` : 'not wearing yet';
    tyres += `<div class="shero"><b style="color:${lapsColor(w.left)}">${fmtLaps(w.left)}</b>
      <span>laps until <em>${w.n}</em> hits ${wearLimit}%<br><small>${w.left === 0 ? 'already past the limit' : boxLap}</small></span></div>
      <div class="scorners">${tp.corners.map(c => `<div><span>${c.n}</span><b style="color:${lapsColor(c.left)}">${fmtLaps(c.left)}</b>
        <small>${c.rate == null ? '–' : c.rate.toFixed(2) + '%/lap'}</small></div>`).join('')}</div>`;
  } else {
    tyres += '<div class="swait">Measuring wear rate — needs about a lap on this set of tyres</div>';
  }
  parts.push(tyres + '</div>');

  // pit
  let pit = '<div class="sblk"><div class="shd"><span class="lbl">Pit</span></div>';
  if (se.pitIdealLap > 0) pit += `<div class="sline"><span>Game pit window</span><b>L${se.pitIdealLap}${se.pitLatestLap > 0 ? ' – L' + se.pitLatestLap : ''}</b></div>`;
  if (se.pitRejoinPos > 0) pit += `<div class="sline"><span>Game rejoin estimate</span><b>P${se.pitRejoinPos}</b></div>`;
  pit += s.pitLoss
    ? `<div class="sline"><span>Pit loss · measured</span><b>${fmtS(s.pitLoss.ms)}s</b><small>${s.pitLoss.samples} stop${s.pitLoss.samples === 1 ? '' : 's'}</small></div>`
    : '<div class="sline"><span>Pit loss</span><small>measured after the first stop by any car</small></div>';
  const rj = rejoinEstimate(s, me);
  if (rj) {
    const around = [
      rj.ahead && `behind ${nameOf(rj.ahead.r)} ${fmtS(rj.after - rj.ahead.g)}s`,
      rj.behind && `ahead of ${nameOf(rj.behind.r)} ${fmtS(rj.behind.g - rj.after)}s`,
    ].filter(Boolean).join(' · ');
    pit += `<div class="sline hi"><span>Pit now →</span><b>P${rj.pos}</b><small>${around}</small></div>`;
  }
  const fuel = s.status && s.status.m_fuelRemainingLaps;
  if (fuel != null) pit += `<div class="sline"><span>Fuel margin</span><b style="color:${fuel < 0 ? 'var(--red-hi)' : fuel < 0.5 ? 'var(--amber)' : 'var(--text)'}">${fuel >= 0 ? '+' : ''}${fuel.toFixed(2)} laps</b></div>`;
  parts.push(pit + '</div>');

  // pace
  let pace = '<div class="sblk"><div class="shd"><span class="lbl">Pace</span>';
  if (st && st.pace) {
    const p = st.pace;
    pace += `<small>last ${p.laps.length} clean lap${p.laps.length === 1 ? '' : 's'}</small></div>`;
    const ms = p.laps.map(l => l.ms), lo = Math.min(...ms), hi = Math.max(...ms);
    const bars = p.laps.map(l => `<i style="height:${hi > lo ? 25 + ((l.ms - lo) / (hi - lo)) * 75 : 60}%" title="L${l.lap} ${fmtTime(l.ms)}"></i>`).join('');
    const tr = p.trendMs;
    pace += `<div class="space"><div><b>${fmtTime(p.avgMs)}</b><small>avg</small></div>
      <div><b style="color:${tr == null ? 'var(--dim)' : tr > 50 ? 'var(--red-hi)' : tr < -50 ? 'var(--green)' : 'var(--text)'}">${tr == null ? '–' : fmtRate(tr)}</b><small>per lap ${tr == null ? '(3+ laps)' : tr > 0 ? 'slower' : 'faster'}</small></div>
      <div class="sbars">${bars}</div></div>`;
  } else {
    pace += '</div><div class="swait">Needs a clean lap</div>';
  }
  parts.push(pace + '</div>');

  // threats
  const rivals = s.rivals || [];
  const ahead = rivals.find(r => r.pos === me.pos - 1), behind = rivals.find(r => r.pos === me.pos + 1);
  const aheadRate = st && st.gapTrend && ahead && st.gapTrend.aheadIdx === ahead.idx ? st.gapTrend.rateMs : null;
  const bt = behind && behind.strategy && behind.strategy.gapTrend;
  const behindRate = bt && bt.aheadIdx === me.idx ? bt.rateMs : null;
  parts.push(`<div class="sblk"><div class="shd"><span class="lbl">Battles</span><small>gap trend per lap</small></div>
    ${threatRow('AHEAD', ahead, me.gapFront, aheadRate, true)}
    ${threatRow('BEHIND', behind, behind && behind.gapFront, behindRate, false)}</div>`);

  setHtml(box, parts.join(''));
}

// one-line strategy summary for any driver (compare columns, rival popup)
function stratMini(r) {
  const st = r && r.strategy;
  const tp = tyreProjection(st, wearLimit);
  const bits = [];
  if (tp && tp.worst) {
    const w = tp.worst;
    bits.push(`<b style="color:${lapsColor(w.left)}">${fmtLaps(w.left)} laps</b> to ${wearLimit}% <small>(${w.n} ${w.rate == null ? '' : w.rate.toFixed(2) + '%/lap'})</small>`);
  } else bits.push('<small>wear rate: measuring…</small>');
  if (st && st.pace && st.pace.trendMs != null) bits.push(`pace <b>${fmtRate(st.pace.trendMs)}</b><small>/lap</small>`);
  return `<span class="lbl">Strategy</span> ${bits.join(' · ')}`;
}

// --- Main render ---
function render(s) {
  // a new session resets everything learned about the last one, before this message adds anything
  if (s.session && s.session.sessionUID !== sessionUID) {
    sessionUID = s.session.sessionUID;
    track = new Map(); car = null; bestLap = 0; lapTraces.clear(); cmpTrails.clear();
  }
  renderRecording(s);
  renderRivals(s);
  learnTrack(track, s.rivals);
  renderDriver(s);
  renderCompare(s);
  renderStrategy(s);
  $('dot').className = 'dot ' + (s.connected ? 'live' : 'idle');
  $('connText').textContent = s.connected ? 'LIVE' : s.hasData ? 'NO SIGNAL — PAUSED?' : 'WAITING FOR GAME';
  $('pps').textContent = s.pps;
  renderWait(s);
  renderReplay(s);

  if (s.session) {
    const se = s.session;
    $('track').textContent = se.track;
    $('weather').textContent = WEATHER[se.weather] || '—';
    $('trackTemp').textContent = se.trackTemp;
    $('airTemp').textContent = se.airTemp;
    $('totalLaps').textContent = se.totalLaps || '–';
    $('fmtChip').hidden = !(se.packetFormat >= 2026);
    checkFormat(se.packetFormat);
    $('reaction').hidden = !(se.reactionTime > 0);
    if (se.reactionTime > 0) $('reaction').textContent = `REACTION ${se.reactionTime.toFixed(3)}s`;
    $('mapLegend').hidden = !((se.aeroZones && se.aeroZones.length) || (se.drsZones && se.drsZones.length));
  }

  const t = s.telemetry;
  if (t) {
    renderDriving(t, '', samples, s.telemetry2, s.status);
    const lit = Math.round(((t.m_revLightsPercent || 0) / 100) * 15);
    [...rev.children].forEach((el, i) => el.classList.toggle('on', i < lit));
  }
  if (t || s.damage) mainCar.update(t, s.damage);
  if (s.damage) mainDamage.update(s.damage);
  if (s.status) renderStatus(s.status, '', s.session && s.session.packetFormat);

  const l = s.lap;
  if (l) {
    $('pos').textContent = l.m_carPosition || '–';
    $('lapNum').textContent = l.m_currentLapNum || '–';
    $('cur').textContent = fmtTime(l.m_currentLapTimeInMS);
    $('last').textContent = fmtTime(l.m_lastLapTimeInMS);
    if (l.m_lastLapTimeInMS && l.m_lastLapTimeInMS !== lastSeenLast) {
      lastSeenLast = l.m_lastLapTimeInMS;
      if (!bestLap || lastSeenLast < bestLap) bestLap = lastSeenLast;
    }
    $('best').textContent = fmtTime(bestLap);
    const s1 = l.m_sector1TimeInMS ?? l.m_sector1TimeMSPart, s2 = l.m_sector2TimeInMS ?? l.m_sector2TimeMSPart;
    $('s1').querySelector('b').textContent = fmtSector(s1);
    $('s2').querySelector('b').textContent = fmtSector(s2);
    $('s3').querySelector('b').textContent = l.m_sector === 2 ? fmtSector(l.m_currentLapTimeInMS - (s1 || 0) - (s2 || 0)) : '–';
    ['s1', 's2', 's3'].forEach((id, i) => $(id).classList.toggle('active', l.m_sector === i));
    $('invalid').hidden = !l.m_currentLapInvalid;
    $('pit').hidden = !l.m_pitStatus;
    $('wrongWay').hidden = !(s.telemetry2 && s.telemetry2.m_drivingWrongWay);
  }

  if (s.motion) {
    car = s.motion;
    $('gLat').textContent = s.motion.gLat.toFixed(1);
    $('gLong').textContent = s.motion.gLong.toFixed(1);
  }
}

function frame() {
  drawPedalTrace($('trace'), samples);
  drawMap();
  if (!dm.hidden) drawPedalTrace($('dmTrace'), dmSamples);
  if (!cmp.hidden) drawCompareChart();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

let latest = null;
function connect() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onopen = () => { sendSelect(); sendCompare(); };
  ws.onmessage = e => { latest = JSON.parse(e.data); render(latest); };
  ws.onclose = () => {
    $('dot').className = 'dot';
    $('connText').textContent = 'SERVER OFFLINE — RETRYING';
    setTimeout(connect, 1500);
  };
}
connect();

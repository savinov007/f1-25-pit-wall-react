const $ = id => document.getElementById(id);
const WEATHER = ['Clear', 'Light cloud', 'Overcast', 'Light rain', 'Heavy rain', 'Storm'];
const ERS_MODES = ['None', 'Medium', 'Hotlap', 'Overtake'];
const COMPOUNDS = {
  16: ['Soft', '#f92d29'], 17: ['Medium', '#ebd25f'], 18: ['Hard', '#ffffff'],
  7: ['Intermediate', '#3ac82b'], 8: ['Wet', '#4491d2'],
};
const ERS_MAX = 4000000;
const TRACE_SECONDS = 10;
const DISPLAY_FONT = '"Saira Condensed", "Arial Narrow", sans-serif';

// Colour scales. Temperature bands are approximate working windows for the game's surface temps.
const tempColor = t => (t < 80 ? '#3aa0ff' : t < 105 ? '#1fd166' : t < 115 ? '#ffb020' : '#ff2d1f');
const wearColor = w => (w < 25 ? '#1fd166' : w < 45 ? '#e6d84a' : w < 65 ? '#ffb020' : '#ff2d1f');
const dmgLevel = v => (v <= 0 ? 0 : v < 20 ? 1 : v < 50 ? 2 : 3);
const DMG_COLORS = ['', 'rgba(255, 176, 32, .45)', 'rgba(255, 122, 26, .85)', '#ff2d1f'];
const cap = s => s[0].toUpperCase() + s.slice(1);
// Element ids for the main dashboard ('fuel') and the driver modal ('dmFuel')
const idFor = (prefix, name) => $(prefix ? prefix + cap(name) : name);

const fmtTime = ms => {
  if (!ms) return '–';
  const m = Math.floor(ms / 60000), s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
};
const fmtSector = ms => (ms ? (ms / 1000).toFixed(3) : '–');
const fmtGap = (ms, leader) => (leader ? 'LEADER' : ms ? '+' + (ms / 1000).toFixed(3) : '–');
const esc = t => String(t).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

// Rev lights: 15 LEDs (green, red, blue)
const rev = $('rev');
for (let i = 0; i < 15; i++) {
  const el = document.createElement('i');
  el.className = i < 5 ? 'g' : i < 10 ? 'r' : 'b';
  rev.appendChild(el);
}

// --- Car diagram: top-down chassis, tyres coloured by temperature, tread drains with wear ---
// Visual order FL FR RL RR; the game's arrays are RL RR FL FR.
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
const DMG_KEYS = [
  ['m_frontLeftWingDamage', 'FL wing'], ['m_frontRightWingDamage', 'FR wing'], ['m_rearWingDamage', 'Rear wing'],
  ['m_floorDamage', 'Floor'], ['m_diffuserDamage', 'Diffuser'], ['m_sidepodDamage', 'Sidepods'],
  ['m_gearBoxDamage', 'Gearbox'], ['m_engineDamage', 'Engine'],
];
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
function renderDriving(t, prefix, trail) {
  idFor(prefix, 'speed').textContent = t.m_speed;
  idFor(prefix, 'gear').textContent = t.m_gear === 0 ? 'N' : t.m_gear < 0 ? 'R' : t.m_gear;
  idFor(prefix, 'rpm').textContent = t.m_engineRPM;
  idFor(prefix, 'drs').classList.toggle('on', !!t.m_drs);
  idFor(prefix, 'thr').style.height = t.m_throttle * 100 + '%';
  idFor(prefix, 'brk').style.height = t.m_brake * 100 + '%';
  idFor(prefix, 'steer').style.left = 50 + t.m_steer * 45 + '%';
  const now = performance.now();
  trail.push({t: now, thr: t.m_throttle, brk: t.m_brake});
  while (trail.length && now - trail[0].t > TRACE_SECONDS * 1000) trail.shift();
}

function renderStatus(st, prefix) {
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
  idFor(prefix, 'ersMode').textContent = ERS_MODES[st.m_ersDeployMode] || '';
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
let path = [], sessionUID = null, bounds = null, car = null;
function drawMap() {
  const dpr = devicePixelRatio || 1;
  const w = map.clientWidth, h = map.clientHeight;
  if (!w || !h) return;
  if (map.width !== Math.round(w * dpr) || map.height !== Math.round(h * dpr)) { map.width = w * dpr; map.height = h * dpr; }
  mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  mctx.clearRect(0, 0, w, h);
  if (path.length < 2 || !bounds) {
    mctx.fillStyle = '#7a8195'; mctx.textAlign = 'center';
    mctx.font = `600 12px ${DISPLAY_FONT}`;
    mctx.fillText('DRIVE A LAP TO DRAW THE TRACK', w / 2, h / 2);
    return;
  }
  const rivals = ((latest && latest.rivals) || []).filter(r => !r.player && (r.x || r.z));
  // frame the traced lap plus every car, so rivals never sit off-canvas
  const b = rivals.reduce(
    (acc, r) => ({minX: Math.min(acc.minX, r.x), maxX: Math.max(acc.maxX, r.x), minZ: Math.min(acc.minZ, r.z), maxZ: Math.max(acc.maxZ, r.z)}),
    bounds
  );
  const pad = 22, spanX = b.maxX - b.minX || 1, spanZ = b.maxZ - b.minZ || 1;
  const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanZ);
  const ox = (w - spanX * scale) / 2, oy = (h - spanZ * scale) / 2;
  const px = p => ox + (p.x - b.minX) * scale, py = p => oy + (p.z - b.minZ) * scale;
  mctx.lineJoin = 'round'; mctx.lineCap = 'round';
  mctx.beginPath(); path.forEach((p, i) => (i ? mctx.lineTo(px(p), py(p)) : mctx.moveTo(px(p), py(p))));
  mctx.strokeStyle = '#1c2030'; mctx.lineWidth = 12; mctx.stroke();
  mctx.strokeStyle = '#2b3042'; mctx.lineWidth = 8; mctx.stroke();
  mctx.strokeStyle = 'rgba(225, 6, 0, .75)'; mctx.lineWidth = 1.5; mctx.stroke();
  mctx.font = `700 11px ${DISPLAY_FONT}`; mctx.textAlign = 'center';
  for (const r of rivals) {
    const x = px(r), y = py(r);
    mctx.globalAlpha = r.result > 3 ? 0.35 : 1;
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

function addMapPoint(m) {
  car = m;
  const last = path[path.length - 1];
  if (last && Math.hypot(m.x - last.x, m.z - last.z) < 4) return;
  path.push({x: m.x, z: m.z});
  if (path.length > 6000) path.shift();
  bounds = bounds
    ? {minX: Math.min(bounds.minX, m.x), maxX: Math.max(bounds.maxX, m.x), minZ: Math.min(bounds.minZ, m.z), maxZ: Math.max(bounds.maxZ, m.z)}
    : {minX: m.x, maxX: m.x, minZ: m.z, maxZ: m.z};
}

let bestLap = 0, lastSeenLast = 0;

function renderWait(s) {
  const box = $('wait');
  box.hidden = s.hasData || !s.setup;
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
      <span class="n" title="${esc(r.team)}">${esc(r.name)}${r.human && !r.telemetryPublic ? `<small>#${r.num}</small>` : ''}${r.pit ? '<span class="tag pit">PIT</span>' : ''}${r.penalty ? `<span class="tag pen">+${r.penalty}s</span>` : ''}</span>
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
dm.addEventListener('pointerdown', e => { if (e.target === dm) closeDriver(); });
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
  }
  const d = s.detail;
  const note = $('dmNote');
  if (!d || d.idx !== selected || !d.telemetry) { note.hidden = false; note.textContent = 'Waiting for this car\'s data…'; return; }
  const t = d.telemetry;
  const restricted = r && !r.telemetryPublic && !r.player && !t.m_speed && !t.m_engineRPM;
  note.hidden = !restricted;
  if (restricted) note.textContent = 'This driver\'s telemetry is set to Restricted, so the game sends empty values for them.';

  renderDriving(t, 'dm', dmSamples);
  if (d.status) renderStatus(d.status, 'dm');
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
const fmtClock = sec => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
function renderRecording(s) {
  const r = s.recording;
  const btn = $('rec');
  if (!r) return;
  btn.disabled = !r.available;
  btn.classList.toggle('on', r.active);
  btn.title = r.available ? 'Record raw game packets to a file' : 'Recording needs live game data (not available in demo mode)';
  $('recText').textContent = r.active ? `${fmtClock(r.seconds)} · ${r.packets.toLocaleString()} pkts` : 'REC';
  if (wasRecording && !r.active && r.lastFile) {
    const toast = $('toast');
    toast.innerHTML = `Saved <code>${esc(r.lastFile)}</code> · ${(r.lastBytes / 1048576).toFixed(1)} MB · ${r.lastPackets.toLocaleString()} packets<br>Replay: <code>npm run replay -- ${esc(r.lastFile)}</code>`;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 12000);
  }
  wasRecording = r.active;
}
$('rec').onclick = () => {
  if (ws && ws.readyState === 1 && latest && latest.recording) ws.send(JSON.stringify({record: !latest.recording.active}));
};

// --- Main render ---
function render(s) {
  renderRecording(s);
  renderRivals(s);
  renderDriver(s);
  $('dot').className = 'dot ' + (s.connected ? 'live' : 'idle');
  $('connText').textContent = s.connected ? 'LIVE' : s.hasData ? 'NO SIGNAL — PAUSED?' : 'WAITING FOR GAME';
  $('pps').textContent = s.pps;
  renderWait(s);

  if (s.session) {
    const se = s.session;
    if (se.sessionUID !== sessionUID) { sessionUID = se.sessionUID; path = []; bounds = null; car = null; bestLap = 0; }
    $('track').textContent = se.track;
    $('weather').textContent = WEATHER[se.weather] || '—';
    $('trackTemp').textContent = se.trackTemp;
    $('airTemp').textContent = se.airTemp;
    $('totalLaps').textContent = se.totalLaps || '–';
  }

  const t = s.telemetry;
  if (t) {
    renderDriving(t, '', samples);
    const lit = Math.round(((t.m_revLightsPercent || 0) / 100) * 15);
    [...rev.children].forEach((el, i) => el.classList.toggle('on', i < lit));
  }
  if (t || s.damage) mainCar.update(t, s.damage);
  if (s.damage) mainDamage.update(s.damage);
  if (s.status) renderStatus(s.status, '');

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
  }

  if (s.motion) {
    addMapPoint(s.motion);
    $('gLat').textContent = s.motion.gLat.toFixed(1);
    $('gLong').textContent = s.motion.gLong.toFixed(1);
  }
}

function frame() {
  drawPedalTrace($('trace'), samples);
  drawMap();
  if (!dm.hidden) drawPedalTrace($('dmTrace'), dmSamples);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

let latest = null;
function connect() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onopen = sendSelect;
  ws.onmessage = e => { latest = JSON.parse(e.data); render(latest); };
  ws.onclose = () => {
    $('dot').className = 'dot';
    $('connText').textContent = 'SERVER OFFLINE — RETRYING';
    setTimeout(connect, 1500);
  };
}
connect();

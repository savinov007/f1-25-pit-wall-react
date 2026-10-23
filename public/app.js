const $ = id => document.getElementById(id);
const WEATHER = ['Clear', 'Light cloud', 'Overcast', 'Light rain', 'Heavy rain', 'Storm'];
const COMPOUNDS = {
  16: ['Soft', '#f92d29'], 17: ['Medium', '#ebd25f'], 18: ['Hard', '#ffffff'],
  7: ['Intermediate', '#3ac82b'], 8: ['Wet', '#4491d2'],
};
const ERS_MAX = 4000000;
const TRACE_SECONDS = 10;

// Rev lights: 15 LEDs (green, red, blue)
const rev = $('rev');
for (let i = 0; i < 15; i++) {
  const el = document.createElement('i');
  el.className = i < 5 ? 'g' : i < 10 ? 'r' : 'b';
  rev.appendChild(el);
}
// Tyres in visual order FL FR / RL RR; game order is RL RR FL FR
const TYRE_ORDER = [{i: 2, n: 'FL'}, {i: 3, n: 'FR'}, {i: 0, n: 'RL'}, {i: 1, n: 'RR'}];
const tyreEls = TYRE_ORDER.map(t => {
  const el = document.createElement('div');
  el.className = 'tyre';
  el.innerHTML = `<div class="s"><span>${t.n}</span><span class="p"></span></div><div class="t">–</div><div class="s"><span>inner <b class="in">–</b></span><span class="wr">wear –</span></div><div class="w"><i></i></div>`;
  $('tyregrid').appendChild(el);
  return el;
});
const DMG_KEYS = [
  ['m_frontLeftWingDamage', 'FL wing'], ['m_frontRightWingDamage', 'FR wing'], ['m_rearWingDamage', 'Rear wing'],
  ['m_floorDamage', 'Floor'], ['m_engineDamage', 'Engine'], ['m_gearBoxDamage', 'Gearbox'],
];
const dmgEls = DMG_KEYS.map(([, label]) => {
  const el = document.createElement('span');
  el.textContent = label;
  $('dmg').appendChild(el);
  return el;
});

const fmtTime = ms => {
  if (!ms) return '–';
  const m = Math.floor(ms / 60000), s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
};
const fmtSector = ms => (ms ? (ms / 1000).toFixed(3) : '–');
const tyreColor = t => (t < 70 ? '#3aa0ff' : t < 85 ? '#22d36b' : t < 105 ? '#ffb020' : '#e10600');

// --- Rolling pedal trace ---
const trace = $('trace'), tctx = trace.getContext('2d');
const samples = [];
function drawTrace() {
  const dpr = devicePixelRatio || 1;
  const w = trace.clientWidth, h = trace.clientHeight;
  if (trace.width !== w * dpr) { trace.width = w * dpr; trace.height = h * dpr; }
  tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  tctx.clearRect(0, 0, w, h);
  tctx.strokeStyle = '#1d212c';
  for (let i = 1; i < 4; i++) { tctx.beginPath(); tctx.moveTo(0, (h * i) / 4); tctx.lineTo(w, (h * i) / 4); tctx.stroke(); }
  const now = performance.now();
  const line = (key, color) => {
    tctx.beginPath(); tctx.strokeStyle = color; tctx.lineWidth = 2;
    samples.forEach((s, i) => {
      const x = w - ((now - s.t) / (TRACE_SECONDS * 1000)) * w, y = h - 4 - s[key] * (h - 8);
      i ? tctx.lineTo(x, y) : tctx.moveTo(x, y);
    });
    tctx.stroke();
  };
  line('thr', '#22d36b'); line('brk', '#e10600');
}

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
    mctx.fillStyle = '#7c8294'; mctx.textAlign = 'center';
    mctx.fillText('Drive a lap to draw the track', w / 2, h / 2);
    return;
  }
  const pad = 16, spanX = bounds.maxX - bounds.minX || 1, spanZ = bounds.maxZ - bounds.minZ || 1;
  const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanZ);
  const ox = (w - spanX * scale) / 2, oy = (h - spanZ * scale) / 2;
  const px = p => ox + (p.x - bounds.minX) * scale, py = p => oy + (p.z - bounds.minZ) * scale;
  mctx.lineJoin = 'round'; mctx.lineCap = 'round';
  mctx.beginPath(); path.forEach((p, i) => (i ? mctx.lineTo(px(p), py(p)) : mctx.moveTo(px(p), py(p))));
  mctx.strokeStyle = '#2c3140'; mctx.lineWidth = 9; mctx.stroke();
  mctx.strokeStyle = '#e10600'; mctx.lineWidth = 2; mctx.stroke();
  if (car) {
    mctx.beginPath(); mctx.arc(px(car), py(car), 6, 0, Math.PI * 2);
    mctx.fillStyle = '#fff'; mctx.shadowColor = '#fff'; mctx.shadowBlur = 12; mctx.fill(); mctx.shadowBlur = 0;
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

let bestLap = 0, lastSeenLast = 0, curLapNum = 0;

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

let gapMode = 'interval';
$('gapMode').onclick = () => {
  gapMode = gapMode === 'interval' ? 'leader' : 'interval';
  $('gapMode').textContent = gapMode.toUpperCase();
  if (latest) renderRivals(latest);
};

const fmtGap = (ms, leader) => (leader ? 'LEADER' : ms ? '+' + (ms / 1000).toFixed(3) : '–');
const esc = t => String(t).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

function renderRivals(s) {
  const rows = $('rows');
  if (!s.rivals || !s.rivals.length) { rows.innerHTML = '<div class="empty">No rivals yet</div>'; return; }
  const html = s.rivals.map(r => {
    const first = r.pos === 1;
    const gap = gapMode === 'interval' ? r.gapFront : r.gapLeader;
    const [cname, ccolor] = COMPOUNDS[r.compound] || ['–', '#888'];
    const out = r.result > 3; // finished is 3; 4+ = DNF / DSQ / retired
    return `<div class="srow${r.player ? ' me' : ''}${out ? ' out' : ''}" data-idx="${r.idx}">
      <span class="p">${r.pos}</span><span class="team" style="background:${esc(r.color)}"></span>
      <span class="n" title="${esc(r.team)}">${esc(r.name)}${r.human && !r.telemetryPublic ? `<small>#${r.num}</small>` : ''}${r.pit ? '<span class="tag pit">PIT</span>' : ''}${r.penalty ? `<span class="tag pen">+${r.penalty}s</span>` : ''}</span>
      <span class="g">${out ? 'OUT' : fmtGap(gap, first)}</span><span class="l">${fmtTime(r.last)}</span>
      <span class="t"><i style="border-color:${ccolor}" title="${cname}"></i>${r.age}</span></div>`;
  }).join('');
  if (html !== lastRowsHtml) { rows.innerHTML = html; lastRowsHtml = html; }
}

// --- Driver detail modal ---
let lastRowsHtml = '';
let selected = null;
let ws = null;
const dm = $('dm'), dmTrace = $('dmTrace'), dmctx = dmTrace.getContext('2d');
const dmSamples = [];
const dmTyreEls = TYRE_ORDER.map(t => {
  const el = document.createElement('div');
  el.className = 'tyre';
  el.innerHTML = `<div class="s"><span>${t.n}</span><span class="p"></span></div><div class="t">–</div><div class="s"><span>inner <b class="in">–</b></span><span class="wr">wear –</span></div><div class="w"><i></i></div>`;
  $('dmTyres').appendChild(el);
  return el;
});
const dmDmgEls = DMG_KEYS.map(([, label]) => {
  const el = document.createElement('span');
  el.textContent = label;
  $('dmDmg').appendChild(el);
  return el;
});

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

  $('dmSpeed').textContent = t.m_speed;
  $('dmGear').textContent = t.m_gear === 0 ? 'N' : t.m_gear < 0 ? 'R' : t.m_gear;
  $('dmRpm').textContent = t.m_engineRPM;
  $('dmDrs').classList.toggle('on', !!t.m_drs);
  $('dmThr').style.height = t.m_throttle * 100 + '%';
  $('dmBrk').style.height = t.m_brake * 100 + '%';
  $('dmSteer').style.left = 50 + t.m_steer * 45 + '%';
  dmSamples.push({t: performance.now(), thr: t.m_throttle, brk: t.m_brake});
  while (dmSamples.length && performance.now() - dmSamples[0].t > TRACE_SECONDS * 1000) dmSamples.shift();
  dmTyreEls.forEach((el, k) => {
    const i = TYRE_ORDER[k].i, temp = t.m_tyresSurfaceTemperature[i];
    el.querySelector('.t').textContent = Math.round(temp) + '°';
    el.querySelector('.p').textContent = t.m_tyresPressure[i].toFixed(1) + ' psi';
    el.querySelector('.in').textContent = Math.round(t.m_tyresInnerTemperature[i]) + '°';
    el.style.borderColor = tyreColor(temp);
  });
  const st = d.status;
  if (st) {
    const [name, color] = COMPOUNDS[st.m_visualTyreCompound] || ['–', '#888'];
    $('dmCname').textContent = name;
    $('dmCdot').style.borderColor = color;
    $('dmCage').textContent = st.m_tyresAgeLaps + ' laps';
    const fuelPct = st.m_fuelCapacity ? (st.m_fuelInTank / st.m_fuelCapacity) * 100 : 0;
    $('dmFuel').style.width = Math.max(0, Math.min(100, fuelPct)) + '%';
    $('dmFuelTxt').textContent = st.m_fuelInTank.toFixed(1) + ' kg';
    const ersPct = (st.m_ersStoreEnergy / ERS_MAX) * 100;
    $('dmErs').style.width = Math.max(0, Math.min(100, ersPct)) + '%';
    $('dmErsTxt').textContent = Math.round(ersPct) + '%';
  }
  const dg = d.damage;
  if (dg) {
    dmTyreEls.forEach((el, k) => {
      const wear = dg.m_tyresWear[TYRE_ORDER[k].i];
      el.querySelector('.wr').textContent = 'wear ' + Math.round(wear) + '%';
      el.querySelector('.w i').style.width = Math.min(100, wear) + '%';
    });
    DMG_KEYS.forEach(([key, label], i) => {
      dmDmgEls[i].classList.toggle('hot', dg[key] > 0);
      dmDmgEls[i].textContent = label + (dg[key] > 0 ? ' ' + dg[key] + '%' : '');
    });
  }
  const l = d.lap;
  if (l) {
    $('dmCur').textContent = fmtTime(l.m_currentLapTimeInMS);
    $('dmLast').textContent = fmtTime(l.m_lastLapTimeInMS);
    $('dmS1').textContent = fmtSector(l.m_sector1TimeInMS ?? l.m_sector1TimeMSPart);
    $('dmS2').textContent = fmtSector(l.m_sector2TimeInMS ?? l.m_sector2TimeMSPart);
  }
}

function drawDriverTrace() {
  if (dm.hidden) return;
  const dpr = devicePixelRatio || 1, w = dmTrace.clientWidth, h = dmTrace.clientHeight;
  if (!w || !h) return;
  if (dmTrace.width !== Math.round(w * dpr)) { dmTrace.width = w * dpr; dmTrace.height = h * dpr; }
  dmctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  dmctx.clearRect(0, 0, w, h);
  dmctx.strokeStyle = '#1d212c';
  for (let i = 1; i < 4; i++) { dmctx.beginPath(); dmctx.moveTo(0, (h * i) / 4); dmctx.lineTo(w, (h * i) / 4); dmctx.stroke(); }
  const now = performance.now();
  const line = (key, color) => {
    dmctx.beginPath(); dmctx.strokeStyle = color; dmctx.lineWidth = 2;
    dmSamples.forEach((p, i) => {
      const x = w - ((now - p.t) / (TRACE_SECONDS * 1000)) * w, y = h - 4 - p[key] * (h - 8);
      i ? dmctx.lineTo(x, y) : dmctx.moveTo(x, y);
    });
    dmctx.stroke();
  };
  line('thr', '#22d36b'); line('brk', '#e10600');
}

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

function render(s) {
  renderRecording(s);
  renderRivals(s);
  renderDriver(s);
  const dot = $('dot');
  dot.className = 'dot ' + (s.connected ? 'live' : 'idle');
  $('connText').textContent = s.connected ? 'Live' : s.hasData ? 'No signal (game paused?)' : 'Waiting for game…';
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
    $('speed').textContent = t.m_speed;
    $('gear').textContent = t.m_gear === 0 ? 'N' : t.m_gear < 0 ? 'R' : t.m_gear;
    $('rpm').textContent = t.m_engineRPM;
    $('drs').classList.toggle('on', !!t.m_drs);
    $('thr').style.height = t.m_throttle * 100 + '%';
    $('brk').style.height = t.m_brake * 100 + '%';
    $('steer').style.left = 50 + t.m_steer * 45 + '%';
    const lit = Math.round(((t.m_revLightsPercent || 0) / 100) * 15);
    [...rev.children].forEach((el, i) => el.classList.toggle('on', i < lit));
    samples.push({t: performance.now(), thr: t.m_throttle, brk: t.m_brake});
    while (samples.length && performance.now() - samples[0].t > TRACE_SECONDS * 1000) samples.shift();
    tyreEls.forEach((el, k) => {
      const i = TYRE_ORDER[k].i, temp = t.m_tyresSurfaceTemperature[i];
      el.querySelector('.t').textContent = Math.round(temp) + '°';
      el.querySelector('.p').textContent = t.m_tyresPressure[i].toFixed(1) + ' psi';
      el.querySelector('.in').textContent = Math.round(t.m_tyresInnerTemperature[i]) + '°';
      el.style.borderColor = tyreColor(temp);
    });
  }

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

  const st = s.status;
  if (st) {
    const [name, color] = COMPOUNDS[st.m_visualTyreCompound] || ['–', '#888'];
    $('cname').textContent = name;
    $('cdot').style.borderColor = color;
    $('cage').textContent = st.m_tyresAgeLaps + ' laps';
    const fuelPct = st.m_fuelCapacity ? (st.m_fuelInTank / st.m_fuelCapacity) * 100 : 0;
    $('fuel').style.width = Math.max(0, Math.min(100, fuelPct)) + '%';
    $('fuelTxt').textContent = st.m_fuelInTank.toFixed(1) + ' kg';
    const ersPct = (st.m_ersStoreEnergy / ERS_MAX) * 100;
    $('ers').style.width = Math.max(0, Math.min(100, ersPct)) + '%';
    $('ersTxt').textContent = Math.round(ersPct) + '%';
  }

  const d = s.damage;
  if (d) {
    tyreEls.forEach((el, k) => {
      const wear = d.m_tyresWear[TYRE_ORDER[k].i];
      el.querySelector('.wr').textContent = 'wear ' + Math.round(wear) + '%';
      el.querySelector('.w i').style.width = Math.min(100, wear) + '%';
    });
    DMG_KEYS.forEach(([key], i) => {
      dmgEls[i].classList.toggle('hot', d[key] > 0);
      dmgEls[i].textContent = DMG_KEYS[i][1] + (d[key] > 0 ? ' ' + d[key] + '%' : '');
    });
  }

  if (s.motion) {
    addMapPoint(s.motion);
    $('gLat').textContent = s.motion.gLat.toFixed(1);
    $('gLong').textContent = s.motion.gLong.toFixed(1);
  }
}

function frame() { drawTrace(); drawMap(); drawDriverTrace(); requestAnimationFrame(frame); }
requestAnimationFrame(frame);

let latest = null;
function connect() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onopen = sendSelect;
  ws.onmessage = e => { latest = JSON.parse(e.data); render(latest); };
  ws.onclose = () => {
    $('dot').className = 'dot';
    $('connText').textContent = 'Server offline – retrying…';
    setTimeout(connect, 1500);
  };
}
connect();

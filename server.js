const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {WebSocketServer} = require('ws');
const {F1TelemetryClient, constants} = require('./build/src');
const {StrategyTracker} = require('./strategy');
const {loadRecording, createPlayer} = require('./replay');
const {overtakeOn} = require('./public/lib');

const {PACKETS, TRACKS, TEAMS} = constants;
const PUBLIC = path.join(__dirname, 'public');
const MIME = {'.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml'};
const REC_MAX_BYTES = 500 * 1024 * 1024;
const MAX_COMPARE = 4;

function localIps() {
  const ips = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs) {
      if (a.family === 'IPv4' && !a.internal) ips.push({name, address: a.address});
    }
  }
  return ips;
}

const minutesToMs = (msPart, minutes) => (msPart || 0) + (minutes || 0) * 60000;
const MAX_CARS = 24; // UDP format 2026; 22 before
const validIdx = v => Number.isInteger(v) && v >= 0 && v < MAX_CARS;

// Team ids per the F1 25 2026 Season Pack spec. Format 2026 sends uint16 ids (476 Mercedes '26 ...
// 486 Cadillac '26); format 2025 truncates them to uint8, so the same teams arrive as 220-230.
// The library's colours are the old broadcast palette (near-black RB, plain white Haas, navy Red Bull) that
// disappear on the dark dashboard, so F1 teams get the current livery colours instead.
const TEAM_COLORS = {
  'Mercedes': '#27F4D2', 'Ferrari': '#E80020', 'Red Bull Racing': '#3671C6', 'Williams': '#64C4FF',
  'Aston Martin': '#229971', 'Alpine': '#0093CC', 'RB': '#6692FF', 'Haas': '#B6BABD', 'McLaren': '#FF8000',
  'Sauber': '#52E252', 'Audi': '#F50537', 'Cadillac': '#D9D9E3',
};
function teamFor(id) {
  const t26 = TEAMS[2026] || {}, t25 = TEAMS[2025] || {};
  const t = id >= 256 ? t26[id] : t25[id] || t26[id + 256];
  return t ? {...t, color: TEAM_COLORS[t.name] || t.color} : null;
}

// lap fractions of the active aero zones in use (full or partial set) and the DRS zones
const zones = (list, count) => (list || []).slice(0, count || 0).map(z => [z.m_zoneStart, z.m_zoneEnd]);

// --- Demo data: a synthetic field on an elliptical track so the page can be checked without the game ---
const DEMO_DRIVERS = [
  ['VERSTAPPEN', 'Red Bull Racing', '#3671C6'], ['NORRIS', 'McLaren', '#FF8000'], ['LECLERC', 'Ferrari', '#E80020'],
  ['PIASTRI', 'McLaren', '#FF8000'], ['HAMILTON', 'Ferrari', '#E80020'], ['RUSSELL', 'Mercedes', '#27F4D2'],
  ['ALONSO', 'Aston Martin', '#229971'], ['ANTONELLI', 'Mercedes', '#27F4D2'], ['GASLY', 'Alpine', '#0093CC'],
  ['ALBON', 'Williams', '#64C4FF'], ['TSUNODA', 'Red Bull Racing', '#3671C6'], ['HULKENBERG', 'Sauber', '#52E252'],
];
const DEMO_LAP_MS = 30000;

function demoPos(a) {
  return {x: Math.cos(a) * 400 + Math.cos(a * 2) * 60, z: Math.sin(a) * 250 + Math.sin(a * 3) * 40};
}

function demoRivals(t, lapNum) {
  const lapAngle = ((t % DEMO_LAP_MS) / DEMO_LAP_MS) * Math.PI * 2;
  const you = {name: 'YOU', team: 'Demo', color: '#e10600', num: 99};
  const cars = [...DEMO_DRIVERS.slice(0, 2), you, ...DEMO_DRIVERS.slice(2)];
  return cars.map((c, i) => ({
    idx: i, pos: i + 1, name: c.name || c[0], num: c.num || 10 + i, team: c.team || c[1], color: c.color || c[2],
    lapNum, last: 90000 + i * 180, best: 89000 + ((i * 37) % 9) * 150, gapFront: i ? 400 + ((i * 377 + t / 7) % 2200) : 0, gapLeader: i ? i * 1300 + ((t / 9) % 700) : 0,
    pit: i === 7 ? 1 : 0, stops: i % 3 === 0 ? 1 : 0, penalty: i === 5 ? 5 : 0, result: 2, overtake: i === 4 ? 1 : 0, wrongWay: 0,
    compound: [16, 17, 18][i % 3], age: lapNum + (i % 4), player: c === you,
    ...demoPos(lapAngle + (2 - i) * 0.18),
    strategy: {
      wear: [10 + lapNum * 2 + i % 4, 11 + lapNum * 2, 14 + lapNum * 3, 16 + lapNum * 3 + i % 3],
      wearRate: [1.6 + i * 0.04, 1.7, 2.3 + (i % 3) * 0.2, 2.6 + i * 0.05],
      stintLaps: 4,
      pace: {
        avgMs: 90000 + i * 180, trendMs: 40 + (i % 5) * 35,
        laps: [0, 1, 2, 3, 4].map(k => ({lap: lapNum + k, ms: 90000 + i * 180 + k * (40 + (i % 5) * 35) + ((k * 37 + i) % 5) * 60})),
      },
      gapTrend: i ? {aheadIdx: i - 1, rateMs: [-310, 120, -60, 240, -180][i % 5]} : null,
    },
    dist: ((((lapAngle + (2 - i) * 0.18) / (Math.PI * 2)) % 1 + 1) % 1) * 5000,
  }));
}

// One demo frame for time t (ms since start): the player's telemetry plus the synthetic field.
function demoFrame(t) {
  const lapNum = Math.floor(t / DEMO_LAP_MS) + 1;
  const a = ((t % DEMO_LAP_MS) / DEMO_LAP_MS) * Math.PI * 2;
  const corner = Math.abs(Math.sin(a * 3));
  const speed = Math.round(120 + 190 * (1 - corner));
  const gear = Math.max(1, Math.min(8, Math.round(speed / 40)));
  const throttle = corner < 0.5 ? 1 : 0.2;
  const brake = corner > 0.8 ? 0.8 : 0;
  // spread of wear and damage so every colour band is visible in demo mode
  const wearRamp = base => Math.min(100, base + lapNum * 4 + ((t % DEMO_LAP_MS) / DEMO_LAP_MS) * 4);
  return {
    session: {
      track: 'Demo Circuit', trackId: -1, totalLaps: 30, trackLength: 5000, pitIdealLap: 14, pitLatestLap: 19, pitRejoinPos: 7,
      weather: 0, trackTemp: 34, airTemp: 24, sessionType: 15, timeLeft: 0, duration: 0, sessionUID: 'demo', packetFormat: 2026,
      aeroStatus: 0, aeroZones: [[0.02, 0.14], [0.45, 0.6]], drsZones: [[0.95, 0.04]], reactionTime: 0.214,
    },
    telemetry: {
      m_speed: speed, m_gear: gear, m_engineRPM: 7000 + (speed % 40) * 100 + gear * 150,
      m_throttle: throttle, m_brake: brake, m_steer: Math.sin(a * 3) * 0.7, m_drs: corner < 0.2 ? 1 : 0,
      m_revLightsPercent: Math.min(100, (speed % 40) * 2.5),
      m_tyresSurfaceTemperature: [92 + corner * 8, 94 + corner * 8, 90 + corner * 12, 91 + corner * 12],
      m_tyresInnerTemperature: [98, 99, 96, 97],
      m_tyresPressure: [22.1, 22.3, 23.4, 23.5],
      m_brakesTemperature: [400 + brake * 400, 410 + brake * 400, 380 + brake * 300, 385 + brake * 300],
    },
    lap: {
      m_lastLapTimeInMS: lapNum > 1 ? DEMO_LAP_MS - 120 : 0, m_currentLapTimeInMS: t % DEMO_LAP_MS,
      m_sector1TimeInMS: t % DEMO_LAP_MS > DEMO_LAP_MS / 3 ? 9800 : 0, m_sector2TimeInMS: t % DEMO_LAP_MS > (2 * DEMO_LAP_MS) / 3 ? 10100 : 0,
      m_sector: Math.min(2, Math.floor(((t % DEMO_LAP_MS) / DEMO_LAP_MS) * 3)), m_carPosition: 3, m_currentLapNum: lapNum,
      m_pitStatus: 0, m_currentLapInvalid: 0, m_lapDistance: ((t % DEMO_LAP_MS) / DEMO_LAP_MS) * 5000,
    },
    status: {
      m_fuelInTank: 60 - t / 4000, m_fuelCapacity: 110, m_visualTyreCompound: 17, m_actualTyreCompound: 17, m_tyresAgeLaps: lapNum,
      m_ersStoreEnergy: 4000000 * (0.5 + 0.5 * Math.sin(a)), m_ersDeployMode: corner < 0.2 ? 3 : 2, m_maxRPM: 13000,
      m_fuelRemainingLaps: 1.4 - lapNum * 0.3, m_ersHarvestedLimitPerLap: 8500000,
    },
    // 2026 regulations: straight-mode aero on the straights, overtake mode when close behind
    telemetry2: {
      m_activeAeroMode: corner < 0.3 ? 1 : 0, m_activeAeroAvailable: 1, m_activeAeroActivationDistance: 0,
      m_overtakeAvailable: corner < 0.5 ? 1 : 0, m_overtakeActive: corner < 0.2 ? 1 : 0, m_overtakeActivationDistance: 0,
      m_2026Regulations: 1, m_drivingWrongWay: 0,
    },
    damage: {
      m_tyresWear: [wearRamp(14), wearRamp(18), wearRamp(33), wearRamp(56)],
      m_frontLeftWingDamage: 12, m_frontRightWingDamage: 0, m_rearWingDamage: 0, m_floorDamage: 4,
      m_diffuserDamage: 0, m_sidepodDamage: 27, m_engineDamage: 3, m_gearBoxDamage: 0,
    },
    motion: {...demoPos(a), gLat: Math.sin(a * 3) * 3, gLong: brake ? -3 : 1},
    rivals: demoRivals(t, lapNum),
    pitLoss: {ms: 21400, samples: 3},
  };
}

// Summary of a recording for the replay list: size, when it was recorded and how long it is. The header is the
// first line; the length is the timestamp of the last packet line, read from the end of the file.
function describeRecording(dir, file) {
  const full = path.join(dir, file);
  let fd, st, out;
  try {
    st = fs.statSync(full);
    out = {file, bytes: st.size, modified: st.mtimeMs, startedAt: null, duration: null};
    fd = fs.openSync(full, 'r');
    const head = Buffer.alloc(Math.min(1024, st.size));
    fs.readSync(fd, head, 0, head.length, 0);
    const header = JSON.parse(head.toString('utf8').split('\n')[0]);
    if (header.type !== 'f1rec') return null;
    out.startedAt = header.startedAt || null;
    const size = Math.min(16384, st.size), tail = Buffer.alloc(size);
    fs.readSync(fd, tail, 0, size, st.size - size);
    const lines = tail.toString('utf8').split('\n').filter(Boolean);
    for (let i = lines.length - 1; i > 0; i--) {
      try {
        const t = JSON.parse(lines[i])[0];
        if (Number.isFinite(t)) { out.duration = t; break; }
      } catch (err) {
        // partial or damaged line: try the one before
      }
    }
  } catch (err) {
    return null; // not a readable recording
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return out;
}

// Recordings in dir, newest first
function listRecordings(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter(n => n.endsWith('.jsonl'));
  } catch (err) {
    return [];
  }
  return names.map(n => describeRecording(dir, n)).filter(Boolean).sort((a, b) => b.modified - a.modified);
}

/**
 * One dashboard instance: HTTP for the page, a WebSocket that pushes state ~30x/s, and either the UDP
 * telemetry listener or the demo generator. Ports may be 0 (ephemeral) — read them back after start().
 */
function createDashboard(options = {}) {
  const {
    httpPort = 3000,
    udpPort = 20777,
    demo = false,
    replayFile = null,
    replayIdleMs = 60000, // a replay dashboard opened from the list stops this long after its last tab closes
    onIdle = null,
    recDir = path.join(__dirname, 'recordings'),
    recMaxBytes = REC_MAX_BYTES,
    broadcastMs = 33,
    log = console,
  } = options;

  const state = {
    connected: false,
    hasData: false,
    setup: {ips: localIps(), udpPort, demo},
    replay: null,
    pps: 0,
    session: null,
    telemetry: null,
    telemetry2: null,
    lap: null,
    status: null,
    damage: null,
    motion: null,
    rivals: [],
    recording: {available: false, active: false},
  };

  const strategy = new StrategyTracker();
  // Best lap per car idx: authoritative from sessionHistory packets, else the fastest last lap seen so far.
  const bestLaps = {};
  const observedBest = {};
  let bestSessionUID = null;
  // Latest full per-car arrays, merged into state.rivals.
  const raw = {lap: null, status: null, parts: null, tel: null, tel2: null, dmg: null, mot: null, playerIdx: 0};
  let packetCount = 0;
  let lastPacketAt = 0;
  const timers = [];

  function buildRivals() {
    if (!raw.lap) return [];
    const rivals = [];
    raw.lap.forEach((l, i) => {
      const last = l.m_lastLapTimeInMS;
      if (last > 0 && (!observedBest[i] || last < observedBest[i])) observedBest[i] = last;
      // resultStatus 0 = invalid, 1 = inactive: slot isn't a car in this session
      if (!l.m_carPosition || l.m_resultStatus < 2) return;
      const part = raw.parts && raw.parts[i];
      const status = raw.status && raw.status[i];
      const mot = raw.mot && raw.mot[i];
      const team = part && teamFor(part.m_teamId);
      const t2 = raw.tel2 && raw.tel2[i];
      rivals.push({
        idx: i,
        pos: l.m_carPosition,
        name: (part && part.m_name) || (i === raw.playerIdx ? 'YOU' : `Car ${i + 1}`),
        num: part ? part.m_raceNumber : 0,
        teamId: part ? part.m_teamId : -1,
        human: part ? part.m_aiControlled === 0 : false,
        telemetryPublic: part ? part.m_yourTelemetry === 1 : false,
        team: team ? team.name : '',
        color: team ? team.color : '#888888',
        dist: l.m_lapDistance,
        x: mot ? mot.m_worldPositionX : undefined,
        z: mot ? mot.m_worldPositionZ : undefined,
        lapNum: l.m_currentLapNum,
        last: l.m_lastLapTimeInMS,
        best: bestLaps[i] || observedBest[i] || 0,
        gapFront: l.m_deltaToCarInFrontMSPart !== undefined ? minutesToMs(l.m_deltaToCarInFrontMSPart, l.m_deltaToCarInFrontMinutesPart) : l.m_deltaToCarInFrontInMS || 0,
        gapLeader: l.m_deltaToRaceLeaderMSPart !== undefined ? minutesToMs(l.m_deltaToRaceLeaderMSPart, l.m_deltaToRaceLeaderMinutesPart) : l.m_deltaToRaceLeaderInMS || 0,
        pit: l.m_pitStatus,
        driverStatus: l.m_driverStatus,
        stops: l.m_numPitStops,
        penalty: l.m_penalties,
        result: l.m_resultStatus,
        compound: status ? status.m_visualTyreCompound : 0,
        age: status ? status.m_tyresAgeLaps : 0,
        player: i === raw.playerIdx,
        overtake: overtakeOn(t2, status) ? 1 : 0,
        wrongWay: t2 ? t2.m_drivingWrongWay : 0,
        strategy: strategy.summary(i),
      });
    });
    return rivals.sort((a, b) => a.pos - b.pos);
  }

  // --- Session recording: raw UDP packets as JSON lines [msSinceStart, base64] (replay with replay.js) ---
  const rec = {stream: null, file: null, startedAt: 0, packets: 0, bytes: 0, lastFile: null, lastBytes: 0, lastPackets: 0};

  function startRecording() {
    if (rec.stream || demo) return;
    fs.mkdirSync(recDir, {recursive: true});
    const name = `session-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
    rec.file = path.join(recDir, name);
    rec.stream = fs.createWriteStream(rec.file);
    rec.stream.on('error', err => {
      log.error(`Recording failed: ${err.message}`);
      rec.stream = null;
    });
    rec.startedAt = Date.now();
    rec.packets = 0;
    rec.bytes = 0;
    rec.stream.write(JSON.stringify({type: 'f1rec', version: 1, startedAt: new Date().toISOString(), udpPort}) + '\n');
    log.log(`Recording to ${path.relative(__dirname, rec.file)}`);
  }

  function stopRecording() {
    if (!rec.stream) return Promise.resolve();
    const stream = rec.stream;
    rec.stream = null;
    rec.lastFile = path.relative(__dirname, rec.file);
    rec.lastBytes = rec.bytes;
    rec.lastPackets = rec.packets;
    log.log(`Saved ${rec.lastFile} (${rec.lastPackets} packets, ${(rec.lastBytes / 1048576).toFixed(1)} MB)`);
    return new Promise(resolve => stream.end(resolve));
  }

  function recordPacket(msg) {
    if (!rec.stream) return;
    const line = `[${Date.now() - rec.startedAt},"${msg.toString('base64')}"]\n`;
    rec.stream.write(line);
    rec.packets++;
    rec.bytes += line.length;
    if (rec.bytes > recMaxBytes) {
      log.warn(`Recording hit the ${Math.round(recMaxBytes / 1048576)} MB limit, stopping`);
      stopRecording();
    }
  }

  function recordingState() {
    return {
      available: !demo && !replayFile,
      active: !!rec.stream,
      seconds: rec.stream ? Math.floor((Date.now() - rec.startedAt) / 1000) : 0,
      packets: rec.packets,
      bytes: rec.bytes,
      lastFile: rec.lastFile,
      lastBytes: rec.lastBytes,
      lastPackets: rec.lastPackets,
      file: rec.stream ? rec.file : null,
    };
  }

  // --- Replay list: recordings in recDir, each opened as its own replay dashboard on a free port ---
  const replays = new Set();
  async function openReplay(file) {
    const name = path.basename(String(file || ''));
    if (!name.endsWith('.jsonl') || !fs.existsSync(path.join(recDir, name))) throw new Error('No such recording');
    const dash = createDashboard({
      replayFile: path.join(recDir, name), httpPort: 0, udpPort: 0, recDir, log, broadcastMs,
      replayIdleMs, onIdle: () => { replays.delete(dash); dash.stop(); },
    });
    replays.add(dash);
    try {
      await dash.start();
    } catch (err) {
      replays.delete(dash);
      await dash.stop();
      throw err;
    }
    return {port: dash.ports.http, file: name};
  }

  function api(req, res) {
    const send = (code, body) => res.writeHead(code, {'Content-Type': 'application/json'}).end(JSON.stringify(body));
    if (replayFile) return send(404, {error: 'Not available while replaying'});
    if (req.method === 'GET') return send(200, listRecordings(recDir));
    if (req.method !== 'POST') return send(405, {error: 'Method not allowed'});
    let body = '';
    req.on('data', c => { if ((body += c).length > 4096) req.destroy(); });
    req.on('end', async () => {
      try {
        send(200, await openReplay(JSON.parse(body).file));
      } catch (err) {
        send(err.message === 'No such recording' ? 404 : 400, {error: err.message});
      }
    });
  }

  const httpServer = http.createServer((req, res) => {
    if (req.url.split('?')[0] === '/api/replays') return api(req, res);
    let name;
    try {
      name = req.url === '/' ? 'index.html' : path.normalize(decodeURIComponent(req.url.split('?')[0]));
    } catch (err) {
      res.writeHead(400).end('Bad request');
      return;
    }
    const file = path.join(PUBLIC, name);
    if (!file.startsWith(PUBLIC)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, {'Content-Type': MIME[path.extname(file)] || 'application/octet-stream'});
      res.end(data);
    });
  });
  const wss = new WebSocketServer({server: httpServer});

  // Demo: rivals replay the player's recent telemetry with a per-car delay, so comparisons differ.
  const demoHistory = [];

  function buildDetail(idx) {
    if (demo) {
      const h = demoHistory[Math.max(0, demoHistory.length - 1 - (idx % 12) * 6)] || state;
      const wearShift = (idx % 5) * 4;
      const damage = h.damage && {...h.damage, m_tyresWear: h.damage.m_tyresWear.map(w => Math.min(100, w + wearShift))};
      return {idx, telemetry: h.telemetry, telemetry2: h.telemetry2, status: h.status, damage, lap: h.lap, motion: h.motion};
    }
    const pick = arr => (arr && arr[idx] ? {...arr[idx]} : null);
    const m = raw.mot && raw.mot[idx];
    return {
      idx,
      telemetry: pick(raw.tel),
      telemetry2: pick(raw.tel2),
      status: pick(raw.status),
      damage: pick(raw.dmg),
      lap: pick(raw.lap),
      motion: m ? {gLat: m.m_gForceLateral, gLong: m.m_gForceLongitudinal} : null,
    };
  }

  function handleClientMessage(ws, data) {
    try {
      const msg = JSON.parse(data);
      if ('select' in msg) ws.selected = validIdx(msg.select) ? msg.select : null;
      if ('compare' in msg) {
        ws.compare = Array.isArray(msg.compare) ? [...new Set(msg.compare.filter(validIdx))].slice(0, MAX_COMPARE) : [];
      }
      if ('record' in msg) (msg.record ? startRecording : stopRecording)();
      if (msg.replay && player) controlReplay(msg.replay);
    } catch (err) {
      // ignore malformed client messages
    }
  }

  let idleTimer = null;
  const armIdle = () => {
    clearTimeout(idleTimer);
    if (replayFile && onIdle && replayIdleMs > 0) idleTimer = setTimeout(onIdle, replayIdleMs);
  };
  wss.on('connection', ws => {
    clearTimeout(idleTimer);
    ws.on('close', () => { if (!wss.clients.size) armIdle(); });
    ws.selected = null;
    ws.compare = [];
    ws.on('message', data => handleClientMessage(ws, data));
  });

  // Message for one client: the shared state, plus the driver it has open and the cars it compares.
  function messageFor(client, shared) {
    if (client.selected === null && !client.compare.length) return shared;
    const extra = {};
    if (client.selected !== null) extra.detail = buildDetail(client.selected);
    if (client.compare.length) extra.compare = client.compare.map(buildDetail);
    return JSON.stringify({...state, ...extra});
  }

  // --- Replay: a recording played through the same pipeline as live packets, with player controls ---
  let player = null;
  function controlReplay({action, value}) {
    const n = Number(value);
    if (action === 'toggle') player.toggle();
    else if (action === 'play') player.play();
    else if (action === 'pause') player.pause();
    else if (action === 'speed' && n > 0) player.setSpeed(n);
    else if (action === 'seek' && Number.isFinite(n)) player.seek(n);
    else if (action === 'skip' && Number.isFinite(n)) player.skip(n);
    else if (action === 'restart') player.restart();
    else if (action === 'loop') player.setLoop(!!value);
  }

  function refreshState() {
    state.replay = player ? {file: path.basename(replayFile), ...player.status()} : null;
    state.connected = demo || !!player || Date.now() - lastPacketAt < 3000;
    state.hasData = demo || lastPacketAt > 0;
    if (!demo) {
      state.rivals = buildRivals();
      state.pitLoss = strategy.pitLoss();
    }
    state.recording = recordingState();
    return state;
  }

  function broadcast() {
    const shared = JSON.stringify(refreshState());
    for (const ws of wss.clients) {
      if (ws.readyState === 1) ws.send(messageFor(ws, shared));
    }
  }

  function onPlayer(packet, key, pick) {
    packetCount++;
    lastPacketAt = Date.now();
    state[key] = pick(packet, packet.m_header.m_playerCarIndex);
  }

  // --- Telemetry: parse packets and fold them into state ---
  const client = demo ? null : new F1TelemetryClient({port: udpPort});
  const reported = new Set();

  // Record, then parse; a packet the parser can't handle must not kill the server (logged once per packet id).
  function handlePacket(msg) {
    recordPacket(msg);
    try {
      parseMessage(msg);
    } catch (err) {
      const pid = msg[6];
      if (reported.has(pid)) return;
      reported.add(pid);
      log.warn(
        `Skipping unparsable packet id=${pid} len=${msg.length} format=${msg.length >= 2 ? msg.readUInt16LE(0) : '?'} ` +
          `game=${msg[3]}.${msg[4]} packetVersion=${msg[5]}: ${err.message}`
      );
    }
  }
  const parseMessage = client ? client.handleMessage.bind(client) : () => {};
  if (client) {
    client.handleMessage = handlePacket;
    client.on(PACKETS.carTelemetry, p => {
      raw.tel = p.m_carTelemetryData;
      onPlayer(p, 'telemetry', (pk, i) => ({...pk.m_carTelemetryData[i]}));
    });
    client.on(PACKETS.lapData, p => {
      raw.lap = p.m_lapData;
      strategy.update(raw.lap, raw.dmg, raw.status, state.session && state.session.trackLength);
      raw.playerIdx = p.m_header.m_playerCarIndex;
      onPlayer(p, 'lap', (pk, i) => ({...pk.m_lapData[i]}));
    });
    // UDP format 2026 only: active aero, overtake mode, wrong way
    client.on(PACKETS.carTelemetry2, p => {
      raw.tel2 = p.m_carTelemetry2Data;
      onPlayer(p, 'telemetry2', (pk, i) => ({...pk.m_carTelemetry2Data[i]}));
    });
    client.on(PACKETS.carStatus, p => {
      raw.status = p.m_carStatusData;
      onPlayer(p, 'status', (pk, i) => ({...pk.m_carStatusData[i]}));
    });
    client.on(PACKETS.sessionHistory, p => {
      const lapNum = p.m_bestLapTimeLapNum;
      const lap = lapNum > 0 ? p.m_lapHistoryData[lapNum - 1] : null;
      if (lap && lap.m_lapTimeInMS > 0) bestLaps[p.m_carIdx] = lap.m_lapTimeInMS;
    });
    client.on(PACKETS.participants, p => {
      raw.parts = p.m_participants;
      packetCount++;
      lastPacketAt = Date.now();
    });
    client.on(PACKETS.carDamage, p => {
      raw.dmg = p.m_carDamageData;
      onPlayer(p, 'damage', (pk, i) => ({...pk.m_carDamageData[i]}));
    });
    client.on(PACKETS.motion, p => {
      raw.mot = p.m_carMotionData;
      onPlayer(p, 'motion', (pk, i) => {
        const m = pk.m_carMotionData[i];
        return {x: m.m_worldPositionX, z: m.m_worldPositionZ, gLat: m.m_gForceLateral, gLong: m.m_gForceLongitudinal};
      });
    });
    client.on(PACKETS.session, p =>
      onPlayer(p, 'session', pk => {
        const uid = String(pk.m_header.m_sessionUID);
        if (bestSessionUID !== null && uid !== bestSessionUID) {
          strategy.reset();
          for (const k of Object.keys(bestLaps)) delete bestLaps[k];
          for (const k of Object.keys(observedBest)) delete observedBest[k];
        }
        bestSessionUID = uid;
        return {
          trackId: pk.m_trackId,
          track: TRACKS[pk.m_trackId] ? TRACKS[pk.m_trackId].name : 'Unknown',
          totalLaps: pk.m_totalLaps,
          trackLength: pk.m_trackLength,
          pitIdealLap: pk.m_pitStopWindowIdealLap,
          pitLatestLap: pk.m_pitStopWindowLatestLap,
          pitRejoinPos: pk.m_pitStopRejoinPosition,
          weather: pk.m_weather,
          trackTemp: pk.m_trackTemperature,
          airTemp: pk.m_airTemperature,
          sessionType: pk.m_sessionType,
          timeLeft: pk.m_sessionTimeLeft,
          duration: pk.m_sessionDuration,
          sessionUID: uid,
          packetFormat: pk.m_header.m_packetFormat,
          aeroStatus: pk.m_activeAeroTrackStatus,
          aeroZones: pk.m_activeAeroTrackStatus === 1
            ? zones(pk.m_activeAeroZonesPartial, pk.m_numActiveAeroZonesPartial)
            : zones(pk.m_activeAeroZonesFull, pk.m_numActiveAeroZonesFull),
          drsZones: zones(pk.m_drsZones, pk.m_numDRSZones),
          reactionTime: pk.m_startReactionTime,
        };
      })
    );
  }

  function applyDemoFrame(t) {
    Object.assign(state, demoFrame(t));
    state.pps = 20;
    demoHistory.push({telemetry: state.telemetry, telemetry2: state.telemetry2, status: state.status, damage: state.damage, lap: state.lap, motion: state.motion});
    if (demoHistory.length > 120) demoHistory.shift();
  }

  const ports = {http: httpPort, udp: udpPort};

  async function start() {
    const recording = replayFile ? loadRecording(replayFile) : null; // a bad file fails before anything listens
    await new Promise((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(httpPort, resolve);
    });
    ports.http = httpServer.address().port;
    log.log(`Dashboard: http://localhost:${ports.http}`);
    if (demo) {
      log.log('Demo mode: emitting synthetic telemetry');
      const t0 = Date.now();
      applyDemoFrame(0);
      timers.push(setInterval(() => applyDemoFrame(Date.now() - t0), 50));
    } else if (replayFile) {
      log.log(`Replay mode: ${recording.packets.length} packets from ${replayFile}`);
      player = createPlayer(recording.packets, {send: handlePacket});
      armIdle();
    } else {
      await new Promise(resolve => {
        client.socket.once('listening', resolve);
        client.start();
      });
      ports.udp = client.socket.address().port;
      state.setup.udpPort = ports.udp;
      log.log(`Listening for F1 UDP telemetry on port ${ports.udp}`);
    }
    timers.push(
      setInterval(() => {
        state.setup.ips = localIps();
        state.pps = demo ? 20 : packetCount;
        packetCount = 0;
      }, 1000)
    );
    timers.push(setInterval(broadcast, broadcastMs));
    return ports;
  }

  let stopped = false;
  async function stop() {
    if (stopped) return;
    stopped = true;
    timers.splice(0).forEach(clearInterval);
    clearTimeout(idleTimer);
    if (player) player.stop();
    await Promise.all([...replays].map(d => d.stop()));
    await stopRecording();
    if (client && client.socket) await new Promise(resolve => client.socket.close(resolve));
    for (const ws of wss.clients) ws.terminate();
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => httpServer.close(resolve));
  }

  return {
    state, ports, httpServer, start, stop, handlePacket, broadcast, refreshState, messageFor, handleClientMessage,
    buildRivals, buildDetail, controlReplay, getPlayer: () => player, startRecording, stopRecording, recordingState, applyDemoFrame, strategy,
  };
}

module.exports = {createDashboard, listRecordings, describeRecording, teamFor, minutesToMs, localIps, demoRivals, demoFrame, demoPos, MIME};

if (require.main === module) {
  const at = process.argv.indexOf('--replay');
  const replayFile = at >= 0 ? process.argv[at + 1] : null;
  if (at >= 0 && (!replayFile || replayFile.startsWith('--'))) {
    console.error('Usage: node server.js --replay <recording.jsonl>');
    process.exit(1);
  }
  const dashboard = createDashboard({
    httpPort: Number(process.env.PORT) || 3000,
    udpPort: Number(process.env.UDP_PORT) || 20777,
    demo: process.argv.includes('--demo'),
    replayFile,
  });
  dashboard.start().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
  process.on('SIGINT', async () => {
    await dashboard.stop();
    process.exit(0);
  });
}

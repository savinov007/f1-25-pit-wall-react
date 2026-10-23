const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {WebSocketServer} = require('ws');
const {F1TelemetryClient, constants} = require('./build/src');

const {PACKETS, TRACKS, TEAMS} = constants;
const HTTP_PORT = Number(process.env.PORT) || 3000;
const UDP_PORT = Number(process.env.UDP_PORT) || 20777;
const DEMO = process.argv.includes('--demo');
const PUBLIC = path.join(__dirname, 'public');
const MIME = {'.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript'};

function localIps() {
  const ips = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs) {
      if (a.family === 'IPv4' && !a.internal) ips.push({name, address: a.address});
    }
  }
  return ips;
}

const state = {
  connected: false,
  hasData: false,
  setup: {ips: localIps(), udpPort: UDP_PORT, demo: DEMO},
  pps: 0,
  session: null,
  telemetry: null,
  lap: null,
  status: null,
  damage: null,
  motion: null,
  rivals: [],
  recording: {available: false, active: false},
};

// Latest full per-car arrays, merged into state.rivals.
const raw = {lap: null, status: null, parts: null, tel: null, dmg: null, mot: null, playerIdx: 0};

const minutesToMs = (msPart, minutes) => (msPart || 0) + (minutes || 0) * 60000;

// The 2026 season pack uses team ids 220+. 220 Mercedes, 221 Ferrari, 222 Red Bull and 228 McLaren are
// confirmed against live drivers; the rest follow the same order as the 2025 ids (inferred, not from the spec).
const TEAMS_2026 = {229: {name: 'Audi', color: '#F50537'}, 230: {name: 'Cadillac', color: '#B8B8C0'}};
function teamFor(id) {
  const teams = TEAMS[2025] || {};
  if (teams[id]) return teams[id];
  if (TEAMS_2026[id]) return TEAMS_2026[id];
  return id >= 220 && id < 229 ? teams[id - 220] : null;
}

function buildRivals() {
  if (!raw.lap) return [];
  const rivals = [];
  raw.lap.forEach((l, i) => {
    // resultStatus 0 = invalid, 1 = inactive: slot isn't a car in this session
    if (!l.m_carPosition || l.m_resultStatus < 2) return;
    const part = raw.parts && raw.parts[i];
    const status = raw.status && raw.status[i];
    const team = part && teamFor(part.m_teamId);
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
      lapNum: l.m_currentLapNum,
      last: l.m_lastLapTimeInMS,
      gapFront: l.m_deltaToCarInFrontMSPart !== undefined ? minutesToMs(l.m_deltaToCarInFrontMSPart, l.m_deltaToCarInFrontMinutesPart) : l.m_deltaToCarInFrontInMS || 0,
      gapLeader: l.m_deltaToRaceLeaderMSPart !== undefined ? minutesToMs(l.m_deltaToRaceLeaderMSPart, l.m_deltaToRaceLeaderMinutesPart) : l.m_deltaToRaceLeaderInMS || 0,
      pit: l.m_pitStatus,
      stops: l.m_numPitStops,
      penalty: l.m_penalties,
      result: l.m_resultStatus,
      compound: status ? status.m_visualTyreCompound : 0,
      age: status ? status.m_tyresAgeLaps : 0,
      player: i === raw.playerIdx,
    });
  });
  return rivals.sort((a, b) => a.pos - b.pos);
}
let packetCount = 0;
let lastPacketAt = 0;

// --- Session recording: raw UDP packets as JSON lines [msSinceStart, base64] (replay with replay.js) ---
const REC_DIR = path.join(__dirname, 'recordings');
const REC_MAX_BYTES = 500 * 1024 * 1024;
const rec = {stream: null, file: null, startedAt: 0, packets: 0, bytes: 0, lastFile: null, lastBytes: 0, lastPackets: 0};

function startRecording() {
  if (rec.stream || DEMO) return;
  fs.mkdirSync(REC_DIR, {recursive: true});
  const name = `session-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
  rec.file = path.join(REC_DIR, name);
  rec.stream = fs.createWriteStream(rec.file);
  rec.stream.on('error', err => {
    console.error(`Recording failed: ${err.message}`);
    rec.stream = null;
  });
  rec.startedAt = Date.now();
  rec.packets = 0;
  rec.bytes = 0;
  rec.stream.write(JSON.stringify({type: 'f1rec', version: 1, startedAt: new Date().toISOString(), udpPort: UDP_PORT}) + '\n');
  console.log(`Recording to ${path.relative(__dirname, rec.file)}`);
}

function stopRecording() {
  if (!rec.stream) return;
  rec.stream.end();
  rec.stream = null;
  rec.lastFile = path.relative(__dirname, rec.file);
  rec.lastBytes = rec.bytes;
  rec.lastPackets = rec.packets;
  console.log(`Saved ${rec.lastFile} (${rec.lastPackets} packets, ${(rec.lastBytes / 1048576).toFixed(1)} MB)`);
}

function recordPacket(msg) {
  if (!rec.stream) return;
  const line = `[${Date.now() - rec.startedAt},"${msg.toString('base64')}"]\n`;
  rec.stream.write(line);
  rec.packets++;
  rec.bytes += line.length;
  if (rec.bytes > REC_MAX_BYTES) {
    console.warn('Recording hit the 500 MB limit, stopping');
    stopRecording();
  }
}

function recordingState() {
  return {
    available: !DEMO,
    active: !!rec.stream,
    seconds: rec.stream ? Math.floor((Date.now() - rec.startedAt) / 1000) : 0,
    packets: rec.packets,
    bytes: rec.bytes,
    lastFile: rec.lastFile,
    lastBytes: rec.lastBytes,
    lastPackets: rec.lastPackets,
  };
}

const server = http.createServer((req, res) => {
  const name = req.url === '/' ? 'index.html' : path.normalize(req.url.split('?')[0]);
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
const wss = new WebSocketServer({server});

function buildDetail(idx) {
  if (DEMO) {
    return {idx, telemetry: state.telemetry, status: state.status, damage: state.damage, lap: state.lap, motion: state.motion};
  }
  const pick = arr => (arr && arr[idx] ? {...arr[idx]} : null);
  const m = raw.mot && raw.mot[idx];
  return {
    idx,
    telemetry: pick(raw.tel),
    status: pick(raw.status),
    damage: pick(raw.dmg),
    lap: pick(raw.lap),
    motion: m ? {gLat: m.m_gForceLateral, gLong: m.m_gForceLongitudinal} : null,
  };
}

wss.on('connection', ws => {
  ws.selected = null;
  ws.on('message', data => {
    try {
      const msg = JSON.parse(data);
      if ('select' in msg) {
        ws.selected = Number.isInteger(msg.select) && msg.select >= 0 && msg.select < 22 ? msg.select : null;
      }
      if ('record' in msg) (msg.record ? startRecording : stopRecording)();
    } catch (err) {
      // ignore malformed client messages
    }
  });
});

function broadcast() {
  state.connected = DEMO || Date.now() - lastPacketAt < 3000;
  state.hasData = DEMO || lastPacketAt > 0;
  if (!DEMO) state.rivals = buildRivals();
  state.recording = recordingState();
  const shared = JSON.stringify(state);
  for (const ws of wss.clients) {
    if (ws.readyState !== 1) continue;
    ws.send(ws.selected === null ? shared : JSON.stringify({...state, detail: buildDetail(ws.selected)}));
  }
}

function onPlayer(packet, key, pick) {
  packetCount++;
  lastPacketAt = Date.now();
  const idx = packet.m_header.m_playerCarIndex;
  state[key] = pick(packet, idx);
}

function startUdp() {
  const client = new F1TelemetryClient({port: UDP_PORT});

  // A packet the parser can't handle must not kill the server; log it once per packet id.
  const handleMessage = client.handleMessage.bind(client);
  const reported = new Set();
  client.handleMessage = msg => {
    recordPacket(msg);
    try {
      handleMessage(msg);
    } catch (err) {
      const pid = msg[6];
      if (reported.has(pid)) return;
      reported.add(pid);
      console.warn(
        `Skipping unparsable packet id=${pid} len=${msg.length} format=${msg.readUInt16LE(0)} ` +
          `game=${msg[3]}.${msg[4]} packetVersion=${msg[5]}: ${err.message}`
      );
    }
  };

  client.on(PACKETS.carTelemetry, p => {
    raw.tel = p.m_carTelemetryData;
    onPlayer(p, 'telemetry', (pk, i) => ({...pk.m_carTelemetryData[i]}));
  });
  client.on(PACKETS.lapData, p => {
    raw.lap = p.m_lapData;
    raw.playerIdx = p.m_header.m_playerCarIndex;
    onPlayer(p, 'lap', (pk, i) => ({...pk.m_lapData[i]}));
  });
  client.on(PACKETS.carStatus, p => {
    raw.status = p.m_carStatusData;
    onPlayer(p, 'status', (pk, i) => ({...pk.m_carStatusData[i]}));
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
    onPlayer(p, 'session', pk => ({
      trackId: pk.m_trackId,
      track: TRACKS[pk.m_trackId] ? TRACKS[pk.m_trackId].name : 'Unknown',
      totalLaps: pk.m_totalLaps,
      weather: pk.m_weather,
      trackTemp: pk.m_trackTemperature,
      airTemp: pk.m_airTemperature,
      sessionType: pk.m_sessionType,
      sessionUID: String(pk.m_header.m_sessionUID),
    }))
  );
  client.start();
  console.log(`Listening for F1 UDP telemetry on port ${UDP_PORT}`);
  process.on('SIGINT', () => {
    stopRecording();
    client.stop();
    process.exit(0);
  });
}

const DEMO_DRIVERS = [
  ['VERSTAPPEN', 'Red Bull Racing', '#3671C6'], ['NORRIS', 'McLaren', '#FF8000'], ['LECLERC', 'Ferrari', '#E80020'],
  ['PIASTRI', 'McLaren', '#FF8000'], ['HAMILTON', 'Ferrari', '#E80020'], ['RUSSELL', 'Mercedes', '#27F4D2'],
  ['ALONSO', 'Aston Martin', '#229971'], ['ANTONELLI', 'Mercedes', '#27F4D2'], ['GASLY', 'Alpine', '#0093CC'],
  ['ALBON', 'Williams', '#64C4FF'], ['TSUNODA', 'Red Bull Racing', '#3671C6'], ['HULKENBERG', 'Sauber', '#52E252'],
];

function demoRivals(t, lapNum) {
  const you = {name: 'YOU', team: 'Demo', color: '#e10600', num: 99};
  const cars = [...DEMO_DRIVERS.slice(0, 2), you, ...DEMO_DRIVERS.slice(2)];
  return cars.map((c, i) => ({
    idx: i, pos: i + 1, name: c.name || c[0], num: c.num || 10 + i, team: c.team || c[1], color: c.color || c[2],
    lapNum, last: 90000 + i * 180, gapFront: i ? 400 + ((i * 377 + t / 7) % 2200) : 0, gapLeader: i ? i * 1300 + ((t / 9) % 700) : 0,
    pit: i === 7 ? 1 : 0, stops: i % 3 === 0 ? 1 : 0, penalty: i === 5 ? 5 : 0, result: 2,
    compound: [16, 17, 18][i % 3], age: lapNum + (i % 4), player: c === you,
  }));
}

// Synthetic driver on an elliptical track so the page can be checked without the game.
function startDemo() {
  console.log('Demo mode: emitting synthetic telemetry');
  const t0 = Date.now();
  const LAP_MS = 30000;
  let lastLap = 0;
  setInterval(() => {
    const t = Date.now() - t0;
    const lapNum = Math.floor(t / LAP_MS) + 1;
    const a = ((t % LAP_MS) / LAP_MS) * Math.PI * 2;
    const corner = Math.abs(Math.sin(a * 3));
    const speed = Math.round(120 + 190 * (1 - corner));
    const gear = Math.max(1, Math.min(8, Math.round(speed / 40)));
    const throttle = corner < 0.5 ? 1 : 0.2;
    const brake = corner > 0.8 ? 0.8 : 0;
    if (lapNum > 1 && lapNum !== lastLap) lastLap = lapNum;
    state.session = {track: 'Demo Circuit', trackId: -1, totalLaps: 5, weather: 0, trackTemp: 34, airTemp: 24, sessionType: 15, sessionUID: 'demo'};
    state.telemetry = {
      m_speed: speed, m_gear: gear, m_engineRPM: 7000 + (speed % 40) * 100 + gear * 150,
      m_throttle: throttle, m_brake: brake, m_steer: Math.sin(a * 3) * 0.7, m_drs: corner < 0.2 ? 1 : 0,
      m_revLightsPercent: Math.min(100, (speed % 40) * 2.5),
      m_tyresSurfaceTemperature: [92 + corner * 8, 94 + corner * 8, 90 + corner * 12, 91 + corner * 12],
      m_tyresInnerTemperature: [98, 99, 96, 97],
      m_tyresPressure: [22.1, 22.3, 23.4, 23.5],
      m_brakesTemperature: [400 + brake * 400, 410 + brake * 400, 380 + brake * 300, 385 + brake * 300],
    };
    state.lap = {
      m_lastLapTimeInMS: lastLap ? LAP_MS - 120 : 0, m_currentLapTimeInMS: t % LAP_MS,
      m_sector1TimeInMS: t % LAP_MS > LAP_MS / 3 ? 9800 : 0, m_sector2TimeInMS: t % LAP_MS > (2 * LAP_MS) / 3 ? 10100 : 0,
      m_sector: Math.min(2, Math.floor(((t % LAP_MS) / LAP_MS) * 3)), m_carPosition: 3, m_currentLapNum: lapNum,
      m_pitStatus: 0, m_currentLapInvalid: 0,
    };
    state.status = {
      m_fuelInTank: 60 - t / 4000, m_fuelCapacity: 110, m_visualTyreCompound: 17, m_actualTyreCompound: 17, m_tyresAgeLaps: lapNum,
      m_ersStoreEnergy: 4000000 * (0.5 + 0.5 * Math.sin(a)), m_ersDeployMode: 2, m_maxRPM: 13000,
    };
    state.damage = {
      m_tyresWear: [5 + lapNum * 2, 5 + lapNum * 2, 4 + lapNum * 2, 4 + lapNum * 2],
      m_frontLeftWingDamage: 0, m_frontRightWingDamage: 0, m_rearWingDamage: 0, m_floorDamage: 0, m_engineDamage: 0, m_gearBoxDamage: 0,
    };
    state.motion = {x: Math.cos(a) * 400 + Math.cos(a * 2) * 60, z: Math.sin(a) * 250 + Math.sin(a * 3) * 40, gLat: Math.sin(a * 3) * 3, gLong: brake ? -3 : 1};
    state.pps = 20;
    state.rivals = demoRivals(t, lapNum);
  }, 50);
}

server.listen(HTTP_PORT, () => console.log(`Dashboard: http://localhost:${HTTP_PORT}`));
if (DEMO) startDemo();
else startUdp();

setInterval(() => {
  state.setup.ips = localIps();
  state.pps = DEMO ? 20 : packetCount;
  packetCount = 0;
}, 1000);
setInterval(broadcast, 33);


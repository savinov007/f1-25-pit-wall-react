const {test, describe, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const dgram = require('dgram');
const WebSocket = require('ws');
const {createDashboard, teamFor, minutesToMs, localIps, demoRivals, demoFrame, demoPos} = require('../server');
const {loadRecording} = require('../replay');
const {fixturePackets} = require('./helpers');

const quiet = {log() {}, warn() {}, error() {}};
const tmpDirs = [];
const tmpDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pitwall-test-'));
  tmpDirs.push(d);
  return d;
};
after(() => tmpDirs.forEach(d => fs.rmSync(d, {recursive: true, force: true})));

// A dashboard that isn't listening: packets are fed straight into handlePacket(). All are stopped after the run.
const dashboards = [];
function offline(opts = {}) {
  const d = createDashboard({httpPort: 0, udpPort: 0, recDir: tmpDir(), log: quiet, ...opts});
  dashboards.push(d);
  return d;
}
after(() => Promise.all(dashboards.map(d => d.stop())));
const feedFixture = d => fixturePackets().forEach(p => d.handlePacket(p.buf));
const get = (port, url) => new Promise((resolve, reject) => {
  http.get({host: '127.0.0.1', port, path: url}, res => {
    let body = '';
    res.on('data', c => (body += c));
    res.on('end', () => resolve({status: res.statusCode, type: res.headers['content-type'], body}));
  }).on('error', reject);
});
const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error('timed out');
};
// a copy of the fixture's session-history packet with car `carIdx`'s best lap set
function historyPacket(carIdx, bestMs) {
  const buf = Buffer.from(fixturePackets().find(p => p.buf[6] === 11).buf);
  buf[29] = carIdx; // m_carIdx (2025 header is 29 bytes)
  buf[32] = 1; // m_bestLapTimeLapNum
  buf.writeUInt32LE(bestMs, 36); // m_lapHistoryData[0].m_lapTimeInMS
  return buf;
}

describe('helpers', () => {
  test('team lookup covers 2025 ids and the 2026 season pack', () => {
    assert.equal(teamFor(1).name, 'Ferrari');
    assert.equal(teamFor(221).name, 'Ferrari');
    assert.equal(teamFor(228).name, 'McLaren');
    assert.equal(teamFor(220).name, 'Mercedes');
    assert.equal(teamFor(229).name, 'Audi');
    assert.equal(teamFor(230).name, 'Cadillac');
    assert.equal(teamFor(250), null);
  });
  test('split deltas convert to milliseconds', () => {
    assert.equal(minutesToMs(1234, 2), 121234);
    assert.equal(minutesToMs(undefined, undefined), 0);
  });
  test('local IPv4 addresses', () => {
    for (const ip of localIps()) assert.match(ip.address, /^\d+\.\d+\.\d+\.\d+$/);
  });
  test('demo data: field, player, strategy and progression', () => {
    const r = demoRivals(12000, 2);
    assert.equal(r.length, 13);
    assert.equal(r.filter(c => c.player).length, 1);
    assert.equal(r[2].name, 'YOU');
    assert.ok(r.every(c => c.strategy && c.dist >= 0 && c.dist < 5000));
    const f1 = demoFrame(1000), f2 = demoFrame(31000);
    assert.equal(f1.lap.m_currentLapNum, 1);
    assert.equal(f2.lap.m_currentLapNum, 2);
    assert.equal(f1.lap.m_lastLapTimeInMS, 0);
    assert.ok(f2.lap.m_lastLapTimeInMS > 0);
    assert.ok(f2.damage.m_tyresWear[0] > f1.damage.m_tyresWear[0], 'tyres wear over laps');
    assert.deepEqual(Object.keys(demoPos(0)), ['x', 'z']);
  });
});

describe('telemetry from real packets', () => {
  test('folds packets into the dashboard state', () => {
    const d = offline();
    feedFixture(d);
    const s = d.refreshState();
    assert.equal(s.connected, true);
    assert.equal(s.hasData, true);
    assert.equal(s.session.track, 'Catalunya');
    assert.equal(s.session.trackLength, 4664);
    assert.equal(s.session.sessionUID, '14889307717433790206');
    assert.ok(s.telemetry && s.lap && s.status && s.damage && s.motion, 'player car data');
    assert.equal(s.pitLoss, null);
  });

  test('builds the standings with names, teams and flags', () => {
    const d = offline();
    feedFixture(d);
    const r = d.refreshState().rivals;
    assert.equal(r.length, 10);
    assert.deepEqual(r.map(c => c.pos), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const byName = Object.fromEntries(r.map(c => [c.name, c]));
    assert.equal(byName.LECLERC.team, 'Ferrari');
    assert.equal(byName.LECLERC.num, 16);
    assert.equal(byName.Windman999.player, true, 'player car flagged');
    assert.equal(r.filter(c => c.player).length, 1);
    assert.equal(byName.Windman999.human, true);
    assert.equal(byName.HAMILTON.human, false);
    for (const c of r) {
      assert.ok(Number.isFinite(c.x) && Number.isFinite(c.z), 'map position');
      assert.ok('strategy' in c && 'gapFront' in c && 'gapLeader' in c && 'compound' in c);
    }
  });

  test('cars without participants data still get a name', () => {
    const d = offline();
    fixturePackets().filter(p => p.buf[6] !== 4).forEach(p => d.handlePacket(p.buf));
    const r = d.refreshState().rivals;
    assert.ok(r.some(c => c.name === 'YOU'));
    assert.ok(r.some(c => /^Car \d+$/.test(c.name)));
    assert.ok(r.every(c => c.color === '#888888'));
  });

  test('best lap comes from session history, and a new session clears it', () => {
    const d = offline();
    feedFixture(d);
    d.handlePacket(historyPacket(6, 88888));
    const leclerc = () => d.refreshState().rivals.find(c => c.name === 'LECLERC');
    assert.equal(leclerc().best, 88888);
    const session = Buffer.from(fixturePackets().find(p => p.buf[6] === 1).buf);
    session.writeBigUInt64LE(42n, 7);
    d.handlePacket(session);
    assert.notEqual(leclerc().best, 88888);
    assert.equal(d.state.session.sessionUID, '42');
  });

  test('unparsable packets are skipped and reported once per packet id', () => {
    const warnings = [];
    const d = offline({log: {...quiet, warn: m => warnings.push(m)}});
    const junk = Buffer.alloc(60);
    junk.writeUInt16LE(2025, 0);
    junk[6] = 1;
    d.handlePacket(junk);
    d.handlePacket(junk);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Skipping unparsable packet id=1 len=60 format=2025/);
    d.handlePacket(Buffer.alloc(1));
  });

  test('driver detail and compare payloads per client', () => {
    const d = offline();
    feedFixture(d);
    const detail = d.buildDetail(6);
    assert.equal(detail.idx, 6);
    assert.ok(detail.telemetry && detail.status && detail.damage && detail.lap);
    assert.equal(typeof detail.motion.gLat, 'number');
    const empty = d.buildDetail(21);
    assert.equal(empty.motion.gLat !== undefined, true);
    assert.equal(offline().buildDetail(3).telemetry, null, 'nothing received yet');

    const shared = JSON.stringify(d.refreshState());
    const client = {selected: null, compare: []};
    assert.equal(d.messageFor(client, shared), shared);
    d.handleClientMessage(client, JSON.stringify({select: 6, compare: [0, 6, 6, 9, 99, -1, 'x', 3, 4, 5]}));
    assert.equal(client.selected, 6);
    assert.deepEqual(client.compare, [0, 6, 9, 3], 'deduplicated, valid, at most four');
    const msg = JSON.parse(d.messageFor(client, shared));
    assert.equal(msg.detail.idx, 6);
    assert.deepEqual(msg.compare.map(c => c.idx), [0, 6, 9, 3]);
    d.handleClientMessage(client, JSON.stringify({select: 'nope', compare: 'nope'}));
    assert.equal(client.selected, null);
    assert.deepEqual(client.compare, []);
    d.handleClientMessage(client, '{not json');
  });
});

describe('recording', () => {
  test('records raw packets and replay.js reads them back', async () => {
    const dir = tmpDir();
    const d = offline({recDir: dir});
    d.handleClientMessage({}, JSON.stringify({record: true}));
    const file = d.recordingState().file;
    assert.ok(file && file.startsWith(dir));
    d.startRecording(); // already recording: no-op
    assert.equal(d.recordingState().file, file);
    const packets = fixturePackets();
    packets.forEach(p => d.handlePacket(p.buf));
    assert.equal(d.recordingState().active, true);
    assert.equal(d.recordingState().packets, packets.length);
    await d.stopRecording();
    const st = d.recordingState();
    assert.equal(st.active, false);
    assert.equal(st.lastPackets, packets.length);
    assert.ok(st.lastBytes > 0);
    assert.equal(fs.readdirSync(dir).length, 1);
    const rec = loadRecording(file);
    assert.equal(rec.header.type, 'f1rec');
    assert.equal(rec.packets.length, packets.length);
    assert.ok(rec.packets.every((p, i) => p.buf.equals(packets[i].buf)));
    await d.stopRecording(); // not recording: no-op
  });
  test('the record message stops a recording', async () => {
    const d = offline();
    d.handleClientMessage({}, JSON.stringify({record: true}));
    d.handleClientMessage({}, JSON.stringify({record: false}));
    assert.equal(d.recordingState().active, false);
    assert.ok(d.recordingState().lastFile);
  });
  test('recording is unavailable in demo mode', () => {
    const d = offline({demo: true});
    d.startRecording();
    assert.equal(d.recordingState().available, false);
    assert.equal(d.recordingState().active, false);
  });
});

describe('running server', () => {
  test('serves the page and static files, and blocks escapes', async () => {
    const d = offline();
    const {http: port} = await d.start();
    try {
      const index = await get(port, '/');
      assert.equal(index.status, 200);
      assert.equal(index.type, 'text/html');
      assert.match(index.body, /<title>F1 25 Pit Wall<\/title>/);
      assert.equal((await get(port, '/lib.js')).type, 'text/javascript');
      assert.equal((await get(port, '/style.css')).type, 'text/css');
      assert.equal((await get(port, '/favicon.svg')).type, 'image/svg+xml');
      assert.equal((await get(port, '/nope.js')).status, 404);
      assert.equal((await get(port, '/%E0')).status, 400);
      assert.equal((await get(port, '/%2e%2e/server.js')).status, 404, 'cannot read files outside public/');
      assert.equal((await get(port, '/../package.json')).status, 404);
    } finally {
      await d.stop();
    }
  });

  test('live: UDP packets reach WebSocket clients, with per-client detail', async () => {
    const d = offline({broadcastMs: 20});
    const ports = await d.start();
    assert.ok(ports.udp > 0 && ports.http > 0);
    const ws = new WebSocket(`ws://127.0.0.1:${ports.http}`);
    const messages = [];
    ws.on('message', m => messages.push(JSON.parse(m)));
    try {
      await new Promise(r => ws.on('open', r));
      ws.send(JSON.stringify({select: 6, compare: [6, 9]}));
      const udp = dgram.createSocket('udp4');
      for (const p of fixturePackets()) await new Promise(r => udp.send(p.buf, ports.udp, '127.0.0.1', r));
      udp.close();
      const last = await until(() => {
        const m = messages[messages.length - 1];
        return m && m.rivals.length === 10 && m.detail && m.detail.telemetry ? m : null;
      });
      assert.equal(last.setup.udpPort, ports.udp);
      assert.equal(last.session.track, 'Catalunya');
      assert.equal(last.detail.idx, 6);
      assert.deepEqual(last.compare.map(c => c.idx), [6, 9]);
      assert.equal(last.recording.available, true);
    } finally {
      ws.close();
      await d.stop();
    }
  });

  test('demo: synthetic frames, and cars differ in detail', async () => {
    const d = offline({demo: true, broadcastMs: 20});
    await d.start();
    try {
      assert.equal(d.state.rivals.length, 13);
      assert.equal(d.state.session.track, 'Demo Circuit');
      assert.equal(d.refreshState().connected, true);
      await new Promise(r => setTimeout(r, 400));
      const a = d.buildDetail(0), b = d.buildDetail(1);
      assert.notEqual(a.damage.m_tyresWear[0], b.damage.m_tyresWear[0]);
    } finally {
      await d.stop();
    }
  });
});

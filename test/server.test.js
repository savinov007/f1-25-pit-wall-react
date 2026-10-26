const {test, describe, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const dgram = require('dgram');
const net = require('net');
const {spawn} = require('child_process');
const WebSocket = require('ws');
const {createDashboard, listRecordings, describeRecording, teamFor, minutesToMs, localIps, demoRivals, demoFrame, demoPos} = require('../server');
const {loadRecording, createRecordingWriter, HEADER_BYTES} = require('../replay');
const {historyTrail, historyLaps} = require('../build/shared');
const {fixturePackets, ROOT} = require('./helpers');

const quiet = {log() {}, warn() {}, error() {}};
const tmpDirs = [];
const tmpDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pitwall-test-'));
  tmpDirs.push(d);
  return d;
};
after(() => tmpDirs.forEach(d => fs.rmSync(d, {recursive: true, force: true})));

// A built page as Vite lays it out (index.html, hashed files under assets/, public/ files at the top), so the
// tests don't depend on `npm run build:web` having been run.
function builtPage() {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>F1 25 Pit Wall</title>');
  fs.writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dir, 'assets', 'index-abc123.css'), 'body{}');
  fs.writeFileSync(path.join(dir, 'favicon.svg'), '<svg/>');
  return dir;
}

// A dashboard that isn't listening: packets are fed straight into handlePacket(). All are stopped after the run.
const dashboards = [];
function offline(opts = {}) {
  const d = createDashboard({httpPort: 0, udpPort: 0, recDir: tmpDir(), publicDir: builtPage(), log: quiet, ...opts});
  dashboards.push(d);
  return d;
}
after(() => Promise.all(dashboards.map(d => d.stop())));
const feedFixture = d => fixturePackets().forEach(p => d.handlePacket(p.buf));
const get = (port, url) => new Promise((resolve, reject) => {
  http.get({host: '127.0.0.1', port, path: url}, res => {
    let body = '';
    res.on('data', c => (body += c));
    res.on('end', () => resolve({status: res.statusCode, type: res.headers['content-type'], cache: res.headers['cache-control'], body}));
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
    assert.equal(teamFor(485).name, 'Audi', 'uint16 2026 id');
    assert.equal(teamFor(486).name, 'Cadillac');
    assert.equal(teamFor(476).name, 'Mercedes');
    assert.equal(teamFor(9999), null);
    assert.equal(teamFor(41).name, 'F1 Generic', 'non-F1 ids keep the library colour');
  });
  test('F1 teams get dashboard-friendly colours in both formats', () => {
    assert.equal(teamFor(482).color, '#6692FF', 'RB was near-black');
    assert.equal(teamFor(226).color, '#6692FF', '2025 format truncates 482 to 226');
    assert.equal(teamFor(483).color, '#B6BABD', 'Haas was pure white');
    assert.equal(teamFor(478).color, '#3671C6', 'Red Bull was navy');
    assert.equal(teamFor(2).color, '#3671C6');
    assert.equal(teamFor(484).color, '#FF8000');
    assert.equal(new Set([476, 477, 478, 479, 480, 481, 482, 483, 484, 485, 486].map(i => teamFor(i).color)).size, 11, 'all distinct');
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

  test('standings carry the lap type from the game', () => {
    const d = offline();
    feedFixture(d);
    const r = d.refreshState().rivals;
    assert.ok(r.every(c => Number.isInteger(c.driverStatus)), 'driver status on every car');
    const f26 = require('./f1-2026');
    const e = offline();
    ['participants', 'lapData'].forEach(n => e.handlePacket(f26.build(n)));
    assert.equal(e.refreshState().rivals[0].driverStatus, 4, 'spec-built lap data: everyone on track');
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

describe('UDP format 2026 (F1 26)', () => {
  const f26 = require('./f1-2026');
  const feed2026 = d => Object.keys(f26.SPEC_SIZES).forEach(name => d.handlePacket(f26.build(name)));

  test('24-car standings with the 2026 teams', () => {
    const d = offline();
    feed2026(d);
    const r = d.refreshState().rivals;
    assert.equal(r.length, 24);
    assert.equal(r[23].pos, 24);
    const byName = Object.fromEntries(r.map(c => [c.name, c]));
    assert.equal(byName.Windman999.player, true);
    assert.equal(byName.DRIVER18.team, 'Audi');
    assert.equal(byName.DRIVER20.team, 'Cadillac');
    assert.equal(byName.DRIVER18.color, '#F50537');
  });

  test('car telemetry 2 reaches the state, the standings and the driver detail', () => {
    const d = offline();
    feed2026(d);
    const s = d.refreshState();
    assert.equal(s.telemetry2.m_overtakeActive, 1, 'player car');
    assert.equal(s.telemetry2.m_2026Regulations, 1);
    const byName = Object.fromEntries(s.rivals.map(c => [c.name, c]));
    assert.equal(byName.Windman999.overtake, 1);
    assert.equal(byName.DRIVER23.wrongWay, 1);
    assert.equal(byName.DRIVER5.wrongWay, 0);
    assert.equal(d.buildDetail(1).telemetry2.m_activeAeroMode, 1);
    assert.equal(s.status.m_ersHarvestedLimitPerLap, 8500000);
  });

  test('OT tag needs Boost and a finished countdown, not just the always-on flags', () => {
    const d = offline();
    feed2026(d);
    const car = () => d.refreshState().rivals.find(c => c.name === 'Windman999');
    assert.equal(car().overtake, 1, 'flags set, Boost, no countdown');
    const t2 = f26.build('carTelemetry2');
    t2.writeUInt16LE(150, 29 + 6); // car 0: overtake available in 150 m
    d.handlePacket(t2);
    assert.equal(car().overtake, 0, 'countdown still running');
    t2.writeUInt16LE(0, 29 + 6);
    t2.writeUInt8(0, 29 + 5); // overtakeActive off
    d.handlePacket(t2);
    assert.equal(car().overtake, 0);
    const other = d.refreshState().rivals.find(c => c.name === 'DRIVER1');
    assert.equal(other.overtake, 0, 'flags clear for other cars');
  });

  test('session: format, Madrid, aero and DRS zones, reaction time', () => {
    const d = offline();
    feed2026(d);
    const se = d.refreshState().session;
    assert.equal(se.packetFormat, 2026);
    assert.equal(se.track, 'Madrid');
    assert.equal(se.aeroZones.length, 2, 'full zones while the track status is full');
    assert.ok(Math.abs(se.aeroZones[1][0] - 0.6) < 1e-6);
    assert.equal(se.drsZones.length, 1);
    assert.ok(Math.abs(se.reactionTime - 0.214) < 1e-6);
    const partial = f26.build('session');
    partial.writeUInt8(1, 926 - 173); // m_activeAeroTrackStatus: the first 2026 field (+173 bytes)
    d.handlePacket(partial);
    assert.deepEqual(d.refreshState().session.aeroZones.map(z => z.map(v => +v.toFixed(3))), [[0.6, 0.7]], 'partial zones');
  });

  test('history is recorded before anyone compares, and sent once per watched car', () => {
    const d = offline();
    feedFixture(d); // recorded from the packets themselves: no broadcast has run
    const shared = JSON.stringify(d.refreshState());
    const client = {selected: null, compare: []};
    d.handleClientMessage(client, JSON.stringify({compare: [6, 9]}));
    const first = JSON.parse(d.messageFor(client, shared));
    for (const c of first.compare) {
      const trail = historyTrail(c.history, 0);
      assert.ok(trail.length >= 1, 'a chart opened now already has data');
      assert.ok(trail.every(p => p.t <= 0 && typeof p.ers === 'number' && typeof p.mode === 'number'));
    }
    const [six, nine] = first.compare.map(c => historyLaps(c.history));
    assert.ok(six.cur.length >= 1, 'and the lap so far');
    assert.equal(nine.cur.length, 0, 'car 9 is still behind the start line in the fixture');
    const second = JSON.parse(d.messageFor(client, shared));
    assert.ok(second.compare.every(c => !c.history), 'live updates carry no history');
    d.handleClientMessage(client, JSON.stringify({compare: [9]}));
    d.handleClientMessage(client, JSON.stringify({compare: [6, 9]}));
    const again = JSON.parse(d.messageFor(client, shared));
    assert.deepEqual(again.compare.map(c => !!c.history), [true, false], 'a car dropped and re-added is sent again');
    d.handleClientMessage(client, JSON.stringify({select: 3}));
    assert.ok(JSON.parse(d.messageFor(client, shared)).detail.history, 'the driver window is prefilled too');
    d.handleClientMessage(client, JSON.stringify({select: 6}));
    assert.ok(JSON.parse(d.messageFor(client, shared)).detail.history, 'a car already compared still fills the driver window');
    assert.ok(!JSON.parse(d.messageFor(client, shared)).detail.history);
  });
  test('a car with nothing recorded yet gets its history once something is', () => {
    const d = offline();
    const client = {selected: null, compare: []};
    d.handleClientMessage(client, JSON.stringify({compare: [6]}));
    const shared = JSON.stringify(d.refreshState());
    assert.equal(JSON.parse(d.messageFor(client, shared)).compare[0].history, undefined, 'no packets yet');
    feedFixture(d);
    assert.ok(JSON.parse(d.messageFor(client, shared)).compare[0].history);
  });
  test('every telemetry packet is recorded, whatever the broadcast rate (fast replays keep their detail)', () => {
    const d = offline();
    const packets = fixturePackets();
    const tel = packets.filter(p => p.buf[6] === 6); // packet id 6: car telemetry
    packets.forEach(p => d.handlePacket(p.buf));
    const client = {selected: null, compare: [0]};
    const lt = historyLaps(JSON.parse(d.messageFor(client, JSON.stringify(d.refreshState()))).compare[0].history);
    assert.ok(tel.length > 5);
    assert.ok(lt.cur.length > 1, `${lt.cur.length} lap samples from ${tel.length} telemetry packets, no broadcast`);
  });
  test('demo mode records every car on each frame', () => {
    const d = offline({demo: true});
    for (let t = 0; t <= 2000; t += 50) d.applyDemoFrame(t);
    const client = {selected: null, compare: [0, 2]};
    const msg = JSON.parse(d.messageFor(client, JSON.stringify(d.refreshState())));
    for (const c of msg.compare) assert.ok(historyTrail(c.history, 0).length >= 1 && historyLaps(c.history).cur.length > 1);
  });
  test('the last of 24 cars can be selected and compared', () => {
    const d = offline();
    feed2026(d);
    const client = {selected: null, compare: []};
    d.handleClientMessage(client, JSON.stringify({select: 23, compare: [23, 24]}));
    assert.equal(client.selected, 23);
    assert.deepEqual(client.compare, [23]);
    assert.equal(d.buildDetail(23).telemetry2.m_drivingWrongWay, 1);
  });
});

describe('replay mode', () => {
  const {FIXTURE} = require('./helpers');
  const replaying = async () => {
    const d = offline({replayFile: FIXTURE});
    await d.start();
    return d;
  };

  test('plays the recording through the live pipeline and reports player state', async () => {
    const d = await replaying();
    const first = d.refreshState();
    assert.equal(first.replay.file, 'catalunya-f125.jsonl');
    assert.equal(first.replay.playing, true);
    assert.equal(first.connected, true);
    d.getPlayer().seek(d.getPlayer().status().duration);
    const s = d.refreshState();
    assert.equal(s.session.track, 'Catalunya');
    assert.equal(s.hasData, true);
    assert.equal(s.rivals.length, 10);
    assert.equal(s.recording.available, false, 'no recording while replaying');
  });

  test('stays connected while paused, and live mode has no replay state', async () => {
    const d = await replaying();
    d.controlReplay({action: 'pause'});
    assert.equal(d.refreshState().replay.playing, false);
    assert.equal(d.refreshState().connected, true);
    assert.equal(offline().refreshState().replay, null);
  });

  test('clients control the player', async () => {
    const d = await replaying();
    const p = d.getPlayer();
    const client = {selected: null, compare: []};
    const send = (action, value) => d.handleClientMessage(client, JSON.stringify({replay: {action, value}}));
    send('pause');
    assert.equal(p.status().playing, false);
    send('play');
    assert.equal(p.status().playing, true);
    send('toggle');
    assert.equal(p.status().playing, false);
    send('speed', 3);
    assert.equal(p.status().speed, 3);
    send('speed', 'fast');
    send('speed', -1);
    assert.equal(p.status().speed, 3, 'bad speeds ignored');
    send('seek', 1000);
    assert.equal(p.status().pos, 1000);
    send('skip', 500);
    assert.equal(p.status().pos, 1500);
    send('skip', 'x');
    send('seek', 'x');
    assert.equal(p.status().pos, 1500, 'bad positions ignored');
    send('loop', true);
    assert.equal(p.status().loop, true);
    send('restart');
    assert.equal(p.status().pos, 0);
    send('bogus');
    d.handleClientMessage({selected: null, compare: []}, JSON.stringify({replay: {action: 'pause'}}));
  });

  test('replay messages are ignored when not replaying', () => {
    const d = offline();
    d.handleClientMessage({selected: null, compare: []}, JSON.stringify({replay: {action: 'pause'}}));
    assert.equal(d.getPlayer(), null);
  });

  test('command line: --replay needs a file, and rejects a bad one', () => {
    const run = args => require('child_process').spawnSync(process.execPath, [path.join(ROOT, 'server.js'), ...args], {encoding: 'utf8', env: {...process.env, PORT: '0', UDP_PORT: '0'}});
    assert.match(run(['--replay']).stderr, /Usage: node server.js --replay/);
    assert.equal(run(['--replay']).status, 1);
    const bad = run(['--replay', path.join(ROOT, 'package.json')]);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /Not a recording file/);
  });
});

describe('replay list', () => {
  const {FIXTURE} = require('./helpers');
  const post = (port, body) => new Promise((resolve, reject) => {
    const req = http.request({host: '127.0.0.1', port, path: '/api/replays', method: 'POST'}, res => {
      let out = '';
      res.on('data', c => (out += c));
      res.on('end', () => resolve({status: res.statusCode, body: JSON.parse(out)}));
    });
    req.on('error', reject);
    req.end(typeof body === 'string' ? body : JSON.stringify(body));
  });
  // a recordings folder with the fixture (copied twice, so ordering can be checked) and files that aren't recordings
  function recFolder() {
    const dir = tmpDir();
    fs.copyFileSync(FIXTURE, path.join(dir, 'old.jsonl'));
    fs.copyFileSync(FIXTURE, path.join(dir, 'new.jsonl'));
    fs.utimesSync(path.join(dir, 'old.jsonl'), new Date(2020, 0, 1), new Date(2020, 0, 1));
    fs.writeFileSync(path.join(dir, 'junk.jsonl'), 'not a recording\n');
    fs.writeFileSync(path.join(dir, 'empty.jsonl'), '');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello');
    fs.writeFileSync(path.join(dir, 'half.f1rec.tmp'), 'a conversion in progress');
    return dir;
  }
  // the fixture as a compressed recording; crashed: as left by a server that died mid-recording (header not filled in)
  async function compressedCopy(dir, name, {crashed = false, date = new Date(2021, 0, 1)} = {}) {
    const file = path.join(dir, name);
    const w = createRecordingWriter(file, {startedAt: '2021-01-01T00:00:00.000Z', udpPort: 20777});
    loadRecording(FIXTURE).packets.forEach(p => w.write(p.t, p.buf));
    await w.end();
    if (crashed) {
      const buf = fs.readFileSync(file);
      const blank = Buffer.from(JSON.stringify({type: 'f1rec', version: 2, compression: 'br', packets: null, duration: null}).padEnd(HEADER_BYTES - 1) + '\n');
      blank.copy(buf, 0);
      fs.writeFileSync(file, buf);
    }
    fs.utimesSync(file, date, date);
    return file;
  }
  async function running(dir, opts = {}) {
    const d = offline({recDir: dir, ...opts});
    await d.start();
    return d;
  }

  test('lists recordings newest first with size, start time and length', () => {
    const list = listRecordings(recFolder());
    assert.deepEqual(list.map(r => r.file), ['new.jsonl', 'old.jsonl'], 'junk, empty and non-jsonl files skipped');
    const r = list[0];
    assert.equal(r.bytes, fs.statSync(FIXTURE).size);
    assert.equal(typeof r.startedAt, 'string');
    assert.ok(r.duration > 1000 && r.duration < 10000, `fixture is a couple of seconds long: ${r.duration}`);
    assert.deepEqual(listRecordings(path.join(tmpDir(), 'missing')), [], 'no folder yet');
    assert.equal(describeRecording(recFolder(), 'junk.jsonl'), null);
    assert.equal(describeRecording(recFolder(), 'nope.jsonl'), null);
  });

  test('compressed recordings are listed with the length from their header', async () => {
    const dir = recFolder();
    await compressedCopy(dir, 'packed.f1rec');
    await compressedCopy(dir, 'crashed.f1rec', {crashed: true, date: new Date(2019, 0, 1)});
    const list = listRecordings(dir);
    assert.deepEqual(list.map(r => r.file), ['new.jsonl', 'packed.f1rec', 'old.jsonl', 'crashed.f1rec'], 'both kinds, newest first; .tmp skipped');
    const packed = list[1];
    assert.equal(packed.startedAt, '2021-01-01T00:00:00.000Z');
    assert.equal(packed.duration, loadRecording(FIXTURE).packets[320].t);
    assert.ok(packed.bytes < list[0].bytes / 5);
    assert.equal(list[3].duration, null, 'a recording that never stopped has no length yet');
  });

  test('a compressed recording opens as a replay', async () => {
    const dir = recFolder();
    await compressedCopy(dir, 'packed.f1rec');
    const d = await running(dir);
    const opened = await post(d.ports.http, {file: 'packed.f1rec'});
    assert.equal(opened.status, 200);
    const ws = new WebSocket(`ws://127.0.0.1:${opened.body.port}`);
    const msg = await new Promise(resolve => ws.on('message', m => resolve(JSON.parse(m))));
    assert.equal(msg.replay.file, 'packed.f1rec');
    assert.equal(msg.replay.packets, 321);
    ws.close();
    assert.equal((await post(d.ports.http, {file: 'half.f1rec.tmp'})).status, 404, 'not a recording name');
  });

  test('GET /api/replays returns the list', async () => {
    const d = await running(recFolder());
    const res = await get(d.ports.http, '/api/replays');
    assert.equal(res.status, 200);
    assert.match(res.type, /json/);
    assert.deepEqual(JSON.parse(res.body).map(r => r.file), ['new.jsonl', 'old.jsonl']);
  });

  test('POST opens the recording as its own replay dashboard on a free port', async () => {
    const d = await running(recFolder());
    const opened = await post(d.ports.http, {file: 'new.jsonl'});
    assert.equal(opened.status, 200);
    assert.equal(opened.body.file, 'new.jsonl');
    assert.notEqual(opened.body.port, d.ports.http);
    const ws = new WebSocket(`ws://127.0.0.1:${opened.body.port}`);
    const msg = await new Promise(resolve => ws.on('message', m => resolve(JSON.parse(m))));
    assert.equal(msg.replay.file, 'new.jsonl');
    assert.equal(msg.replay.playing, true);
    assert.equal((await get(opened.body.port, '/')).status, 200, 'serves the same dashboard page as the live one');
    ws.close();
    // the live dashboard is untouched
    assert.equal(d.refreshState().replay, null);
    const second = await post(d.ports.http, {file: 'new.jsonl'});
    assert.notEqual(second.body.port, opened.body.port, 'each open gets its own player');
  });

  test('rejects bad requests: unknown files, path escapes, other file types, bad JSON, wrong method', async () => {
    const dir = recFolder();
    const d = await running(dir);
    assert.equal((await post(d.ports.http, {file: 'missing.jsonl'})).status, 404);
    assert.equal((await post(d.ports.http, {file: 'notes.txt'})).status, 404);
    assert.equal((await post(d.ports.http, {})).status, 404);
    const escape = await post(d.ports.http, {file: '../package.json'});
    assert.equal(escape.status, 404, 'only files inside the recordings folder');
    assert.equal((await post(d.ports.http, {file: 'junk.jsonl'})).status, 400, 'exists but is not a recording');
    assert.equal((await post(d.ports.http, '{nope')).status, 400);
    const put = await new Promise(resolve => http.request({host: '127.0.0.1', port: d.ports.http, path: '/api/replays', method: 'PUT'}, res => { res.resume(); resolve(res.statusCode); }).end());
    assert.equal(put, 405);
    assert.equal(d.refreshState().replay, null);
  });

  test('a replay dashboard has no replay list of its own', async () => {
    const d = await running(recFolder(), {replayFile: FIXTURE});
    assert.equal((await get(d.ports.http, '/api/replays')).status, 404);
  });

  test('an opened replay stops itself once its last tab has closed', async () => {
    const d = await running(recFolder(), {replayIdleMs: 150});
    const {port} = (await post(d.ports.http, {file: 'new.jsonl'})).body;
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise(resolve => ws.on('open', resolve));
    await new Promise(r => setTimeout(r, 300));
    assert.equal((await get(port, '/')).status, 200, 'still running while a tab is connected');
    ws.close();
    const gone = async () => { try { await get(port, '/'); return false; } catch (err) { return true; } };
    const end = Date.now() + 3000;
    let stopped = false;
    while (Date.now() < end && !(stopped = await gone())) await new Promise(r => setTimeout(r, 50));
    assert.equal(stopped, true, 'stopped after the idle time');
  });

  test('a replay nobody ever connects to also stops, and stopping the dashboard stops its replays', async () => {
    const d = await running(recFolder(), {replayIdleMs: 150});
    const {port} = (await post(d.ports.http, {file: 'new.jsonl'})).body;
    const gone = async p => { try { await get(p, '/'); return false; } catch (err) { return true; } };
    const end = Date.now() + 3000;
    while (Date.now() < end && !(await gone(port))) await new Promise(r => setTimeout(r, 50));
    assert.equal(await gone(port), true, 'never-connected replay stopped');
    const e = await running(recFolder(), {replayIdleMs: 60000});
    const other = (await post(e.ports.http, {file: 'old.jsonl'})).body.port;
    await e.stop();
    assert.equal(await gone(other), true, 'parent stop closes its replays');
  });
});

describe('recording', () => {
  const {FIXTURE} = require('./helpers');
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
    assert.equal(st.lastBytes, fs.statSync(file).size, 'the final size, after the last compressed block');
    assert.equal(fs.readdirSync(dir).length, 1);
    assert.ok(file.endsWith('.f1rec'));
    assert.ok(st.lastBytes < fs.statSync(FIXTURE).size / 5, 'compressed: far smaller than the plain fixture');
    const rec = loadRecording(file);
    assert.equal(rec.header.type, 'f1rec');
    assert.equal(rec.header.compression, 'br');
    assert.equal(rec.header.packets, packets.length, 'the header gets the count and length when it stops');
    assert.equal(rec.header.duration, rec.packets[rec.packets.length - 1].t);
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
  test('stops at the size limit, counted on disk (compressed)', async () => {
    const warnings = [];
    const d = offline({recMaxBytes: 5000, recFlushMs: 10, log: {...quiet, warn: m => warnings.push(m)}});
    d.startRecording();
    fixturePackets().forEach(p => d.handlePacket(p.buf));
    assert.equal(d.recordingState().active, true, 'compressed bytes reach the disk at the next flush');
    await until(() => !d.recordingState().active);
    assert.ok(d.recordingState().lastBytes > 5000);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /limit, stopping/);
  });
  test('a failed write ends the recording instead of crashing', {skip: process.getuid && process.getuid() === 0}, async () => {
    const dir = tmpDir();
    fs.chmodSync(dir, 0o500);
    const errors = [];
    const d = offline({recDir: dir, log: {...quiet, error: m => errors.push(m)}});
    d.startRecording();
    await until(() => errors.length);
    assert.match(errors[0], /Recording failed/);
    assert.equal(d.recordingState().active, false);
    fs.chmodSync(dir, 0o700);
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
    const d = offline({publicDir: builtPage()});
    const {http: port} = await d.start();
    try {
      const index = await get(port, '/');
      assert.equal(index.status, 200);
      assert.equal(index.type, 'text/html');
      assert.match(index.body, /<title>F1 25 Pit Wall<\/title>/);
      assert.equal(index.cache, 'no-cache', 'the page is checked every time, so a rebuild shows at once');
      const js = await get(port, '/assets/index-abc123.js');
      assert.equal(js.type, 'text/javascript');
      assert.equal(js.cache, 'public, max-age=31536000, immutable', 'hashed assets are cached for good');
      assert.equal((await get(port, '/assets/index-abc123.css')).type, 'text/css');
      assert.equal((await get(port, '/favicon.svg')).type, 'image/svg+xml');
      assert.equal((await get(port, '/nope.js')).status, 404);
      assert.equal((await get(port, '/%E0')).status, 400);
      assert.equal((await get(port, '/%2e%2e/server.js')).status, 404, 'cannot read files outside the page directory');
      assert.equal((await get(port, '/../package.json')).status, 404);
      // a request path without the leading slash could climb out of the page directory: refused
      const raw = await new Promise(resolve => {
        const sock = net.connect(port, '127.0.0.1', () => sock.write('GET x/../../server.js HTTP/1.1\r\nHost: x\r\n\r\n'));
        let data = '';
        sock.on('data', c => (data += c));
        sock.on('end', () => resolve(data));
        sock.on('close', () => resolve(data));
        setTimeout(() => sock.end(), 300);
      });
      assert.match(raw, /^HTTP\/1\.1 400/, "Node's parser refuses it before our code runs");
      // ...and the handler's own guard refuses it too, should a path like that ever reach it
      const res = {status: null, writeHead(code) { this.status = code; return this; }, end() {}};
      d.httpServer.emit('request', {url: 'x/../../server.js'}, res);
      assert.equal(res.status, 403);
    } finally {
      await d.stop();
    }
  });

  test('says how to build the page when it has not been built', async () => {
    const d = offline({publicDir: tmpDir()});
    const {http: port} = await d.start();
    try {
      const index = await get(port, '/');
      assert.equal(index.status, 503);
      assert.match(index.body, /npm run build:web/);
      assert.equal((await get(port, '/assets/missing.js')).status, 404, 'other files are plain not-found');
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

  test('counts packets per second', async () => {
    const d = offline();
    await d.start();
    try {
      feedFixture(d);
      // motion, session, lap data, participants, telemetry, status and damage packets count; 191 in the fixture
      await until(() => d.state.pps > 0, 2500);
      assert.equal(d.state.pps, 191);
      await until(() => d.state.pps === 0, 2500);
    } finally {
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

describe('command line', () => {
  // starts `node server.js` on a random port, returns the process, its output so far and the port
  async function launch(args, env = {}) {
    const port = 30000 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js'), ...args], {
      env: {...process.env, PORT: String(port), UDP_PORT: String(port + 1), PUBLIC_DIR: builtPage(), ...env},
    });
    const out = {text: ''};
    child.stdout.on('data', c => (out.text += c));
    await until(() => out.text.includes('Dashboard:'), 5000);
    return {child, out, port};
  }
  const exited = child => new Promise(r => child.on('exit', code => r(code)));

  test('demo mode serves the page and stops cleanly on Ctrl+C', async () => {
    const {child, out, port} = await launch(['--demo']);
    assert.match(out.text, /Demo mode/);
    assert.equal((await get(port, '/')).status, 200);
    child.kill('SIGINT');
    assert.equal(await exited(child), 0);
  });

  test('live mode listens on UDP_PORT', async () => {
    const {child, out, port} = await launch([]);
    await until(() => out.text.includes('Listening for F1 UDP telemetry'), 5000);
    assert.match(out.text, new RegExp(`port ${port + 1}`));
    child.kill('SIGINT');
    assert.equal(await exited(child), 0);
  });
});

describe('session time', () => {
  test('time left and duration come from the session packet', () => {
    const d = offline();
    const f26 = require('./f1-2026');
    d.handlePacket(f26.build('session'));
    const se = d.refreshState().session;
    assert.equal(se.timeLeft, 3600);
    assert.equal(se.duration, 7200);
    assert.equal(se.sessionType, 15);
  });
});

describe('player without a car', () => {
  const f26 = require('./f1-2026');
  const noCar = name => { const b = f26.build(name); b[27] = 255; return b; }; // m_playerCarIndex 255: spectating / in menus
  test('packets with no player car index are handled, not skipped as unparsable', () => {
    const warnings = [];
    const d = offline({log: {log() {}, error() {}, warn: m => warnings.push(m)}});
    ['participants', 'lapData', 'motion', 'carTelemetry', 'carTelemetry2', 'carStatus', 'carDamage', 'session'].forEach(n => d.handlePacket(noCar(n)));
    assert.deepEqual(warnings, [], 'nothing skipped');
    const s = d.refreshState();
    for (const k of ['telemetry', 'telemetry2', 'lap', 'status', 'damage', 'motion']) assert.equal(s[k], null, `${k}: no player car`);
    assert.equal(s.rivals.length, 24, 'the standings and map still work for every car');
    assert.ok(Number.isFinite(s.rivals[3].x), 'rival positions still come through');
    assert.equal(s.session.track, 'Madrid', 'session data is not tied to a car');
    assert.equal(s.rivals.filter(r => r.player).length, 0);
  });
});

describe('demo compare data', () => {
  test('demo cars drive differently and throttle is not an on/off step', () => {
    const d = offline({demo: true});
    for (let t = 0; t < 6000; t += 50) d.applyDemoFrame(t);
    const [a, b, c] = [0, 1, 2].map(i => d.buildDetail(i));
    assert.notEqual(a.telemetry.m_throttle, b.telemetry.m_throttle, 'cars differ');
    assert.notEqual(a.lap.m_lapDistance, c.lap.m_lapDistance, 'and sit at different distances');
    const values = new Set();
    for (let t = 0; t < 30000; t += 250) values.add(require('../server').demoFrame(t).telemetry.m_throttle.toFixed(2));
    assert.ok(values.size > 6, `throttle takes many values over a lap: ${values.size}`);
    assert.ok([...values].every(v => v >= 0 && v <= 1));
  });
});

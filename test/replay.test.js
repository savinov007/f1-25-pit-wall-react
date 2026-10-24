const {test, describe, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dgram = require('dgram');
const {spawnSync} = require('child_process');
const zlib = require('zlib');
const {
  parseArgs, loadRecording, recordingBody, createRecordingWriter, headerLine, packetLine, isRecordingName,
  replay, createPlayer, SPEEDS, USAGE, REC_EXT, HEADER_BYTES,
} = require('../replay');
const {compressRecording, main: compressMain} = require('../scripts/compress-recordings');
const {FIXTURE, ROOT} = require('./helpers');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pitwall-replay-'));
after(() => fs.rmSync(dir, {recursive: true, force: true}));
const write = (name, text) => {
  const f = path.join(dir, name);
  fs.writeFileSync(f, text);
  return f;
};

// A UDP socket on an ephemeral port that collects what it receives (with arrival times).
async function receiver() {
  const sock = dgram.createSocket('udp4');
  const got = [];
  sock.on('message', m => got.push({at: Date.now(), m}));
  await new Promise(r => sock.bind(0, '127.0.0.1', r));
  return {port: sock.address().port, got, close: () => sock.close()};
}

describe('arguments', () => {
  test('defaults', () => {
    assert.deepEqual(parseArgs(['rec.jsonl']), {file: 'rec.jsonl', speed: 1, port: 20777, host: '127.0.0.1', loop: false});
  });
  test('options in any order, file not confused with option values', () => {
    assert.deepEqual(parseArgs(['--speed', '4', '--port', '20778', 'a.jsonl', '--host', '10.0.0.2', '--loop']),
      {file: 'a.jsonl', speed: 4, port: 20778, host: '10.0.0.2', loop: true});
    assert.equal(parseArgs(['--speed', '2']).file, undefined);
    assert.equal(parseArgs(['x.jsonl', '--speed', 'fast']).speed, 1, 'invalid speed falls back to 1x');
  });
});

describe('loading recordings', () => {
  test('reads the header and decodes packets', () => {
    const rec = loadRecording(FIXTURE);
    assert.equal(rec.header.type, 'f1rec');
    assert.equal(rec.packets.length, 321);
    assert.ok(Buffer.isBuffer(rec.packets[0].buf));
    assert.equal(rec.packets[0].buf.readUInt16LE(0), 2025);
  });
  test('rejects files that are not recordings', () => {
    assert.throws(() => loadRecording(write('a.json', '{"name":"x"}\n[0,"AA=="]\n')), /Not a recording file/);
    assert.throws(() => loadRecording(write('b.txt', 'hello\n')), /Not a recording file/);
    assert.throws(() => loadRecording(write('c.jsonl', '')), /Not a recording file/);
    assert.throws(() => loadRecording(write('d.jsonl', '{"type":"f1rec"}\n')), /no packets/);
  });
});

// the fixture written as a compressed (version 2) recording
async function compressedFixture(name, opts) {
  const file = path.join(dir, name);
  const {header, packets} = loadRecording(FIXTURE);
  const w = createRecordingWriter(file, {startedAt: header.startedAt, udpPort: 20777}, opts);
  for (const p of packets) w.write(p.t, p.buf);
  return {file, packets, result: await w.end()};
}
const sameData = (a, b) => a.length === b.length && a.every((p, i) => p.t === b[i].t && p.buf.equals(b[i].buf));
const quietLog = () => {
  const lines = [];
  return {lines, log: {log: m => lines.push(m), error: m => lines.push('ERROR ' + m)}};
};

describe('compressed recordings', () => {
  test('round trip: every packet comes back exactly, the header knows the count and length', async () => {
    const {file, packets, result} = await compressedFixture('round.f1rec');
    assert.deepEqual(result, {packets: 321, duration: packets[320].t, bytes: fs.statSync(file).size});
    const rec = loadRecording(file);
    assert.ok(sameData(rec.packets, packets));
    assert.equal(rec.header.type, 'f1rec');
    assert.equal(rec.header.version, 2);
    assert.equal(rec.header.compression, 'br');
    assert.equal(rec.header.udpPort, 20777);
    assert.equal(rec.header.packets, 321);
    assert.equal(rec.header.duration, packets[320].t);
    assert.equal(fs.readFileSync(file).indexOf(10), HEADER_BYTES - 1, 'a fixed-size header line');
  });
  test('the packet lines decompress byte for byte to what a plain recording stores', async () => {
    const {file} = await compressedFixture('bytes.f1rec');
    const plain = fs.readFileSync(FIXTURE);
    assert.ok(recordingBody(file).body.equals(plain.subarray(plain.indexOf(10) + 1)));
  });
  test('much smaller than the plain recording', async () => {
    const {file} = await compressedFixture('small.f1rec');
    const ratio = fs.statSync(FIXTURE).size / fs.statSync(file).size;
    assert.ok(ratio > 5, `only ${ratio.toFixed(1)}x smaller`);
  });
  test('flushed while recording, so a crash keeps what was written', async () => {
    const file = path.join(dir, 'flush.f1rec');
    const packets = loadRecording(FIXTURE).packets;
    const w = createRecordingWriter(file, {}, {flushMs: 10});
    try {
      packets.slice(0, 100).forEach(p => w.write(p.t, p.buf));
      const size = () => (fs.existsSync(file) ? fs.statSync(file).size : 0);
      const t0 = Date.now();
      while (size() <= HEADER_BYTES && Date.now() - t0 < 3000) await new Promise(r => setTimeout(r, 10));
      // the file as it is now, before end(): what a crash would leave
      const crashed = write('crashed.f1rec', fs.readFileSync(file));
      const rec = loadRecording(crashed);
      assert.ok(sameData(rec.packets, packets.slice(0, 100)), 'everything up to the flush');
      assert.equal(rec.header.duration, null, 'never stopped: no length in the header');
    } finally {
      await w.end(); // or its flush timer keeps the process alive
    }
  });
  test('a compressed file cut mid-block still gives the packets before the cut', async () => {
    const {file, packets} = await compressedFixture('cut.f1rec');
    const buf = fs.readFileSync(file);
    const rec = loadRecording(write('cut2.f1rec', buf.subarray(0, buf.length - 200)));
    assert.ok(rec.packets.length > 200 && rec.packets.length < 321);
    assert.ok(sameData(rec.packets, packets.slice(0, rec.packets.length)));
  });
  test('damaged files: a cut-off last line is skipped, a broken line in the middle is an error', () => {
    const line = packetLine(5, Buffer.from([1, 2, 3]));
    const head = '{"type":"f1rec"}\n';
    assert.equal(loadRecording(write('tail.jsonl', head + line + line.slice(0, 6))).packets.length, 1);
    assert.equal(loadRecording(write('crlf-free.jsonl', head + '\n\n' + line)).packets.length, 1, 'blank lines ignored');
    assert.throws(() => loadRecording(write('mid.jsonl', head + line + 'garbage\n' + line)), /Damaged recording: line 3/);
    const bad = write('notbrotli.f1rec', headerLine({type: 'f1rec', compression: 'br'}) + 'definitely not brotli');
    assert.throws(() => loadRecording(bad));
  });
  test('a write that fails reports it, and end() still finishes', async () => {
    const errors = [];
    const w = createRecordingWriter(path.join(dir, 'missing-folder', 'x.f1rec'), {}, {flushMs: 5, onError: e => errors.push(e)});
    w.write(0, Buffer.from([1]));
    const t0 = Date.now();
    while (!errors.length && Date.now() - t0 < 3000) await new Promise(r => setTimeout(r, 5));
    assert.equal(errors[0].code, 'ENOENT');
    assert.deepEqual(await w.end(), {packets: 1, duration: 0, bytes: HEADER_BYTES});
  });
  test('a file removed while recording reports that its header could not be finished', async () => {
    const file = path.join(dir, 'vanished.f1rec');
    const errors = [];
    const w = createRecordingWriter(file, {}, {onError: e => errors.push(e)});
    w.write(0, Buffer.from([1]));
    while (!fs.existsSync(file)) await new Promise(r => setTimeout(r, 5));
    fs.unlinkSync(file);
    const result = await w.end();
    assert.equal(result.packets, 1);
    assert.equal(errors[0].code, 'ENOENT');
  });
  test('header line limits and recording file names', () => {
    assert.equal(headerLine({type: 'f1rec'}).length, HEADER_BYTES);
    assert.throws(() => headerLine({type: 'f1rec', note: 'x'.repeat(HEADER_BYTES)}), /too long/);
    assert.equal(REC_EXT, '.f1rec');
    assert.ok(isRecordingName('a.f1rec') && isRecordingName('a.jsonl'));
    assert.ok(!isRecordingName('a.f1rec.tmp') && !isRecordingName('a.json'));
  });
});

describe('compressing old recordings', () => {
  const copy = name => {
    const f = path.join(dir, name);
    fs.copyFileSync(FIXTURE, f);
    fs.utimesSync(f, new Date(2024, 0, 2), new Date(2024, 0, 2));
    return f;
  };
  test('converts losslessly, keeps the date, removes the original', async () => {
    const f = copy('old1.jsonl');
    const r = await compressRecording(f);
    assert.equal(r.out, f.replace(/\.jsonl$/, '.f1rec'));
    assert.equal(fs.existsSync(f), false);
    assert.ok(r.after < r.before / 5);
    assert.equal(r.packets, 321);
    assert.ok(sameData(loadRecording(r.out).packets, loadRecording(FIXTURE).packets));
    assert.equal(loadRecording(r.out).header.startedAt, loadRecording(FIXTURE).header.startedAt, 'header fields kept');
    assert.equal(fs.statSync(r.out).mtime.getTime(), new Date(2024, 0, 2).getTime(), 'same place in the replay list');
  });
  test('--keep keeps the original; already compressed or other files are skipped', async () => {
    const f = copy('old2.jsonl');
    await compressRecording(f, {keep: true});
    assert.ok(fs.existsSync(f));
    assert.match((await compressRecording(f)).skipped, /already exists/);
    assert.match((await compressRecording(f.replace(/\.jsonl$/, '.f1rec'))).skipped, /not a plain/);
  });
  test('a recording that cannot be read is left alone and reported', async () => {
    const bad = write('broken.jsonl', '{"type":"f1rec"}\n[0,"AA=="]\nnope\n[1,"AA=="]\n');
    const {lines, log} = quietLog();
    const code = await compressMain([bad], {log});
    assert.equal(code, 1);
    assert.ok(fs.existsSync(bad));
    assert.equal(fs.existsSync(bad.replace(/\.jsonl$/, '.f1rec')), false);
    assert.equal(fs.existsSync(bad.replace(/\.jsonl$/, '.f1rec.tmp')), false);
    assert.match(lines[0], /^ERROR Could not compress .*Damaged recording/);
  });
  test('if the compressed copy does not read back identical, nothing is replaced or removed', async () => {
    const f = copy('mismatch.jsonl');
    const replayModule = require('../replay');
    const real = replayModule.loadRecording;
    // the copy reads back with one byte different
    replayModule.loadRecording = file => {
      const rec = real(file);
      if (file.endsWith('.tmp')) rec.packets[100].buf[10] ^= 1;
      return rec;
    };
    try {
      await assert.rejects(compressRecording(f), /does not match; original kept/);
    } finally {
      replayModule.loadRecording = real;
    }
    assert.ok(fs.existsSync(f));
    assert.equal(fs.existsSync(f.replace(/\.jsonl$/, '.f1rec')), false);
    assert.equal(fs.existsSync(f.replace(/\.jsonl$/, '.f1rec.tmp')), false);
  });
  test('a copy that cannot be written leaves the original and no half-written file', {skip: process.getuid && process.getuid() === 0}, async () => {
    const folder = fs.mkdtempSync(path.join(dir, 'ro-'));
    const f = path.join(folder, 'ro.jsonl');
    fs.copyFileSync(FIXTURE, f);
    fs.chmodSync(folder, 0o500);
    try {
      await assert.rejects(compressRecording(f), {code: 'EACCES'});
      assert.deepEqual(fs.readdirSync(folder), ['ro.jsonl']);
    } finally {
      fs.chmodSync(folder, 0o700);
    }
  });
  test('with no files named it does every .jsonl in the folder and prints the totals', async () => {
    const folder = fs.mkdtempSync(path.join(dir, 'recs-'));
    fs.copyFileSync(FIXTURE, path.join(folder, 'a.jsonl'));
    fs.copyFileSync(FIXTURE, path.join(folder, 'b.jsonl'));
    fs.writeFileSync(path.join(folder, 'notes.txt'), 'x');
    const {lines, log} = quietLog();
    assert.equal(await compressMain([], {dir: folder, log}), 0);
    assert.deepEqual(fs.readdirSync(folder).sort(), ['a.f1rec', 'b.f1rec', 'notes.txt']);
    assert.match(lines[0], /^a\.f1rec: [\d.]+ MB -> [\d.]+ MB \([\d.]+x smaller, 321 packets checked\)$/);
    assert.match(lines[2], /^Total: /);
    const empty = quietLog();
    assert.equal(await compressMain([], {dir: path.join(folder, 'missing'), log: empty.log}), 0);
    assert.deepEqual(empty.lines, ['No .jsonl recordings to compress']);
    const kept = quietLog();
    fs.copyFileSync(FIXTURE, path.join(folder, 'c.jsonl'));
    await compressMain(['--keep'], {dir: folder, log: kept.log});
    assert.match(kept.lines.at(-1), /originals kept/);
    assert.ok(fs.existsSync(path.join(folder, 'c.jsonl')));
    const skip = quietLog();
    await compressMain([path.join(folder, 'c.jsonl')], {log: skip.log});
    assert.match(skip.lines[0], /^Skipped .*already exists/);
  });
});

describe('replaying', () => {
  const packets = [0, 40, 80, 120].map((t, i) => ({t, buf: Buffer.from([i])}));

  test('sends every packet in order with the original spacing', async () => {
    const r = await receiver();
    const start = Date.now();
    await replay(packets, {port: r.port}).done;
    r.close();
    assert.deepEqual(r.got.map(g => g.m[0]), [0, 1, 2, 3]);
    assert.ok(r.got[3].at - start >= 110, 'took about 120 ms');
  });
  test('speed shortens the gaps', async () => {
    const r = await receiver();
    const start = Date.now();
    await replay(packets, {port: r.port, speed: 4}).done;
    r.close();
    assert.equal(r.got.length, 4);
    assert.ok(r.got[3].at - start < 100, 'about 30 ms at 4x');
  });
  test('loop repeats until stopped', async () => {
    const r = await receiver();
    const run = replay(packets, {port: r.port, speed: 4, loop: true});
    await new Promise(res => setTimeout(res, 150));
    await run.stop();
    await run.stop(); // second stop is harmless
    r.close();
    assert.ok(r.got.length > 4, `looped (${r.got.length} packets)`);
  });
});

describe('command line', () => {
  const run = args => spawnSync(process.execPath, [path.join(ROOT, 'replay.js'), ...args], {encoding: 'utf8'});
  test('prints usage without a file', () => {
    const r = run([]);
    assert.equal(r.status, 1);
    assert.equal(r.stderr.trim(), USAGE);
  });
  test('reports a bad file', () => {
    const r = run([path.join(ROOT, 'package.json')]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Not a recording file/);
  });
  test('replays a file to the given port', async () => {
    const r = await receiver();
    const out = await new Promise(resolve => {
      const {spawn} = require('child_process');
      const p = spawn(process.execPath, [path.join(ROOT, 'replay.js'), FIXTURE, '--port', String(r.port), '--speed', '20']);
      let text = '';
      p.stdout.on('data', d => (text += d));
      p.on('close', () => resolve(text));
    });
    r.close();
    assert.match(out, /Replaying 321 packets/);
    assert.match(out, /Replay finished/);
    assert.equal(r.got.length, 321);
  });
});

describe('controllable player', () => {
  // packets 100 ms apart; packet type (header byte 6) cycles 0, 1, 2 so seeking has keyframes to find
  const mk = n => Array.from({length: n}, (_, i) => ({t: i * 100, buf: Buffer.from([i, 0, 0, 0, 0, 0, i % 3])}));
  // a manual clock, so the tests don't wait
  function setup(n = 10, opts = {}) {
    let clock = 1000;
    const sent = [];
    const p = createPlayer(mk(n), {send: b => sent.push(b[0]), now: () => clock, tickMs: 1e9, ...opts});
    const advance = ms => { clock += ms; p.tick(); };
    return {p, sent, advance};
  }

  test('plays packets as the clock reaches them, and ends', () => {
    const {p, sent, advance} = setup(4);
    advance(0);
    assert.deepEqual(sent, [0], 'packet at t=0');
    advance(250);
    assert.deepEqual(sent, [0, 1, 2]);
    advance(500);
    assert.deepEqual(sent, [0, 1, 2, 3]);
    assert.equal(p.status().finished, true);
    assert.equal(p.status().playing, false);
    assert.equal(p.status().pos, 300);
    p.stop();
  });

  test('pause holds the position, resume continues from it', () => {
    const {p, sent, advance} = setup();
    advance(250);
    p.pause();
    assert.equal(p.status().playing, false);
    const n = sent.length;
    advance(5000);
    assert.equal(sent.length, n, 'nothing sent while paused');
    assert.equal(p.status().pos, 250);
    p.toggle();
    assert.equal(p.status().playing, true);
    advance(100);
    assert.equal(p.status().pos, 350);
    assert.equal(sent.at(-1), 3);
    p.pause();
    p.pause(); // twice is harmless
    p.stop();
  });

  test('speed scales the clock without jumping the position', () => {
    const {p, advance} = setup();
    advance(200);
    p.setSpeed(2);
    assert.equal(p.status().pos, 200, 'changing speed keeps the position');
    advance(200);
    assert.equal(p.status().pos, 600);
    p.setSpeed(0);
    p.setSpeed(-3);
    p.setSpeed('x');
    assert.equal(p.status().speed, 2, 'invalid speeds ignored');
    assert.deepEqual(SPEEDS.filter(s => s >= 2), [2, 3, 5, 10]);
    p.stop();
  });

  test('seek jumps, replaying the latest packet of each type first', () => {
    const {p, sent, advance} = setup();
    advance(0);
    sent.length = 0;
    p.seek(750);
    assert.deepEqual(sent, [5, 6, 7], 'keyframes: newest of types 2, 0, 1 before t=750, oldest first');
    assert.equal(p.status().pos, 750);
    advance(100);
    assert.equal(sent.at(-1), 8, 'continues from there');
    p.seek(-500);
    assert.equal(p.status().pos, 0);
    p.seek(1e9);
    assert.equal(p.status().pos, 900, 'clamped to the end');
    p.stop();
  });

  test('skip moves relative to the current position, restart goes to 0', () => {
    const {p, advance} = setup();
    advance(300);
    p.skip(-200);
    assert.equal(p.status().pos, 100);
    p.skip(400);
    assert.equal(p.status().pos, 500);
    p.restart();
    assert.equal(p.status().pos, 0);
    p.stop();
  });

  test('play after the end starts over; seeking back clears the ended state', () => {
    const {p, sent, advance} = setup(3);
    advance(1000);
    assert.equal(p.status().finished, true);
    p.play();
    assert.equal(p.status().finished, false);
    assert.equal(p.status().playing, true);
    assert.equal(p.status().pos, 0);
    advance(0);
    assert.equal(sent.at(-1), 0);
    advance(1000);
    p.seek(0);
    assert.equal(p.status().finished, false);
    p.stop();
  });

  test('loop restarts instead of ending; autoplay false waits for play', () => {
    const {p, sent, advance} = setup(3, {loop: true});
    advance(300);
    assert.equal(p.status().finished, false);
    assert.equal(p.status().playing, true);
    assert.equal(p.status().loop, true);
    advance(0);
    assert.equal(sent.at(-1), 0, 'back at the start');
    p.setLoop(false);
    assert.equal(p.status().loop, false);
    p.stop();
    const idle = setup(3, {autoplay: false});
    idle.advance(500);
    assert.deepEqual(idle.sent, []);
    assert.equal(idle.p.status().playing, false);
    idle.p.play();
    idle.advance(150);
    assert.deepEqual(idle.sent, [0, 1]);
    idle.p.stop();
  });

  test('runs on real timers too', async () => {
    const got = [];
    const p = createPlayer(mk(3).map(x => ({...x, t: x.t / 10})), {send: b => got.push(b[0]), tickMs: 2});
    await new Promise(r => setTimeout(r, 80));
    assert.deepEqual(got, [0, 1, 2]);
    assert.equal(p.status().finished, true);
    assert.equal(p.status().packets, 3);
    p.stop();
  });
});

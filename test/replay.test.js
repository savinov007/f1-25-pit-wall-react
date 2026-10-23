const {test, describe, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dgram = require('dgram');
const {spawnSync} = require('child_process');
const {parseArgs, loadRecording, replay, USAGE} = require('../replay');
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

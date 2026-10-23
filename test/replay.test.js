const {test, describe, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dgram = require('dgram');
const {spawnSync} = require('child_process');
const {parseArgs, loadRecording, replay, createPlayer, SPEEDS, USAGE} = require('../replay');
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

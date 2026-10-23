const {test, describe} = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('dgram');
const path = require('path');
const {spawn} = require('child_process');
const {F1TelemetryClient} = require('../build/src');
const {formatSession, formatTelemetry, formatLap, createListener} = require('../listen');
const {fixturePackets, ROOT} = require('./helpers');

const parsed = id => F1TelemetryClient.parseBufferMessage(fixturePackets().find(p => p.buf[6] === id).buf).packetData.data;

describe('console listener', () => {
  test('formats session, telemetry and lap lines for the player car', () => {
    assert.equal(formatSession(parsed(1)), 'session 2025 track 4');
    assert.match(formatTelemetry(parsed(6)), /^speed=\d+ gear=-?\d rpm=\d+ throttle=\d\.\d\d brake=\d\.\d\d$/);
    assert.match(formatLap(parsed(2)), /^lap=\d+ lastLap=\d+ms$/);
  });

  test('prints a line per session, telemetry and lap packet', () => {
    const lines = [];
    const client = createListener(0, l => lines.push(l));
    for (const {buf} of fixturePackets()) client.handleMessage(buf);
    client.socket.close();
    const count = id => fixturePackets().filter(p => p.buf[6] === id).length;
    assert.equal(lines.length, count(1) + count(6) + count(2));
    assert.ok(lines.includes('session 2025 track 4'));
  });

  test('command line listens on UDP_PORT and prints packets', async () => {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const p = spawn(process.execPath, [path.join(ROOT, 'listen.js')], {env: {...process.env, UDP_PORT: String(port)}});
    let out = '';
    p.stdout.on('data', d => (out += d));
    await new Promise(r => p.stdout.once('data', r));
    const sock = dgram.createSocket('udp4');
    const session = fixturePackets().find(x => x.buf[6] === 1).buf;
    await new Promise(r => sock.send(session, port, '127.0.0.1', r));
    sock.close();
    const end = Date.now() + 3000;
    while (!out.includes('session 2025') && Date.now() < end) await new Promise(r => setTimeout(r, 20));
    p.kill('SIGINT');
    assert.match(out, new RegExp(`Listening for F1 UDP telemetry on port ${port}`));
    assert.match(out, /session 2025 track 4/);
  });
});

// Replays a recording made by the dashboard's REC button to the local UDP port, with original timing.
// Usage: node replay.js recordings/session-<time>.jsonl [--speed 2] [--port 20777] [--host 127.0.0.1] [--loop]
const fs = require('fs');
const dgram = require('dgram');

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--') && !/^\d+(\.\d+)?$/.test(a));
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
if (!file) {
  console.error('Usage: node replay.js <recording.jsonl> [--speed 2] [--port 20777] [--host 127.0.0.1] [--loop]');
  process.exit(1);
}
const speed = Number(opt('speed', 1)) || 1;
const port = Number(opt('port', 20777));
const host = opt('host', '127.0.0.1');
const loop = args.includes('--loop');

const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
const header = JSON.parse(lines[0]);
if (header.type !== 'f1rec') {
  console.error('Not a recording file (missing f1rec header)');
  process.exit(1);
}
const packets = lines.slice(1).map(l => {
  const [t, b64] = JSON.parse(l);
  return {t, buf: Buffer.from(b64, 'base64')};
});
if (!packets.length) {
  console.error('Recording has no packets');
  process.exit(1);
}

const socket = dgram.createSocket('udp4');
function play() {
  const start = Date.now();
  let i = 0;
  (function next() {
    while (i < packets.length && packets[i].t / speed <= Date.now() - start) {
      socket.send(packets[i].buf, port, host);
      i++;
    }
    if (i < packets.length) return setTimeout(next, 2);
    if (loop) return play();
    // let the last datagrams flush before closing the socket
    setTimeout(() => {
      socket.close();
      console.log('Replay finished');
    }, 200);
  })();
}
console.log(`Replaying ${packets.length} packets from ${file} to ${host}:${port} at ${speed}x${loop ? ' (looping)' : ''}`);
play();

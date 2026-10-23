// Replays a recording made by the dashboard's REC button to the local UDP port, with original timing.
// Usage: node replay.js recordings/session-<time>.jsonl [--speed 2] [--port 20777] [--host 127.0.0.1] [--loop]
const fs = require('fs');
const dgram = require('dgram');

const USAGE = 'Usage: node replay.js <recording.jsonl> [--speed 2] [--port 20777] [--host 127.0.0.1] [--loop]';

function parseArgs(args) {
  const opt = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : fallback;
  };
  // the file is the first bare argument that isn't an option's value
  const optionValues = new Set(['speed', 'port', 'host'].map(n => args.indexOf(`--${n}`)).filter(i => i >= 0).map(i => i + 1));
  const file = args.find((a, i) => !a.startsWith('--') && !optionValues.has(i));
  return {
    file,
    speed: Number(opt('speed', 1)) || 1,
    port: Number(opt('port', 20777)),
    host: opt('host', '127.0.0.1'),
    loop: args.includes('--loop'),
  };
}

// Reads a recording: a JSON header line ({type: 'f1rec'}) then one [msSinceStart, base64] line per packet.
function loadRecording(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  let header = null;
  try {
    header = lines.length ? JSON.parse(lines[0]) : null;
  } catch (err) {
    // not JSON at all
  }
  if (!header || header.type !== 'f1rec') throw new Error('Not a recording file (missing f1rec header)');
  const packets = lines.slice(1).map(l => {
    const [t, b64] = JSON.parse(l);
    return {t, buf: Buffer.from(b64, 'base64')};
  });
  if (!packets.length) throw new Error('Recording has no packets');
  return {header, packets};
}

// Sends packets to host:port keeping their relative timing (divided by speed). Resolves when finished.
function replay(packets, {port = 20777, host = '127.0.0.1', speed = 1, loop = false} = {}) {
  const socket = dgram.createSocket('udp4');
  let stopped = false, timer = null, finish;
  const done = new Promise(resolve => { finish = resolve; });
  const close = () => {
    // let the last datagrams flush before closing the socket
    setTimeout(() => socket.close(() => finish()), 200);
  };
  function play() {
    const start = Date.now();
    let i = 0;
    (function next() {
      if (stopped) return;
      while (i < packets.length && packets[i].t / speed <= Date.now() - start) {
        socket.send(packets[i].buf, port, host);
        i++;
      }
      if (i < packets.length) { timer = setTimeout(next, 2); return; }
      if (loop) { play(); return; }
      close();
    })();
  }
  play();
  return {
    done,
    stop() {
      if (stopped) return done;
      stopped = true;
      clearTimeout(timer);
      close();
      return done;
    },
  };
}

module.exports = {parseArgs, loadRecording, replay, USAGE};

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error(USAGE);
    process.exit(1);
  }
  let recording;
  try {
    recording = loadRecording(args.file);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  console.log(`Replaying ${recording.packets.length} packets from ${args.file} to ${args.host}:${args.port} at ${args.speed}x${args.loop ? ' (looping)' : ''}`);
  replay(recording.packets, args).done.then(() => console.log('Replay finished'));
}

// Replays a recording made by the dashboard's REC button to the local UDP port, with original timing.
// Usage: node replay.js recordings/session-<time>.f1rec [--speed 2] [--port 20777] [--host 127.0.0.1] [--loop]
const fs = require('fs');
const dgram = require('dgram');
const zlib = require('zlib');

const USAGE = 'Usage: node replay.js <recording.f1rec|.jsonl> [--speed 2] [--port 20777] [--host 127.0.0.1] [--loop]';

// --- Recording files ---
// Every recording is a JSON header line ({type: 'f1rec'}) then one [msSinceStart, base64] line per packet.
//  version 1 (.jsonl): the lines as plain text.
//  version 2 (.f1rec): the header line in plain text, padded to HEADER_BYTES so it can be rewritten in place with
//    the packet count and duration when the recording stops; then the packet lines, brotli-compressed (lossless,
//    about 12x smaller). Decompressed, the packet lines are byte for byte what version 1 stores.
const REC_EXT = '.f1rec';
const HEADER_BYTES = 512;
const BROTLI = {params: {[zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_LGWIN]: 22}};
const isRecordingName = name => name.endsWith(REC_EXT) || name.endsWith('.jsonl');
const packetLine = (t, buf) => `[${t},"${buf.toString('base64')}"]\n`;

function headerLine(fields) {
  const json = JSON.stringify(fields);
  if (json.length > HEADER_BYTES - 1) throw new Error('Recording header too long');
  return json.padEnd(HEADER_BYTES - 1) + '\n';
}

/**
 * Writes a version 2 recording. write(t, buf) adds a packet; the output is flushed to disk every flushMs (0: only
 * at the end), so a crash loses at most that much. end() finishes the file and fills in the header's packet count
 * and duration; it resolves with {packets, duration, bytes}. onBytes(n) reports the file growing.
 */
function createRecordingWriter(file, fields, {flushMs = 0, onBytes = () => {}, onError = () => {}} = {}) {
  const header = {type: 'f1rec', version: 2, compression: 'br', ...fields, packets: null, duration: null};
  const out = fs.createWriteStream(file);
  const brotli = zlib.createBrotliCompress(BROTLI);
  let packets = 0, duration = 0, bytes = HEADER_BYTES, failed = false, closed = false, timer = null;
  const fail = err => {
    if (failed) return;
    failed = true;
    clearInterval(timer);
    onError(err);
  };
  out.on('error', fail);
  out.on('close', () => { closed = true; });
  brotli.on('error', fail);
  brotli.on('data', chunk => {
    bytes += chunk.length;
    onBytes(bytes);
  });
  out.write(headerLine(header));
  brotli.pipe(out);
  if (flushMs > 0) timer = setInterval(() => brotli.flush(), flushMs);
  return {
    write(t, buf) {
      brotli.write(packetLine(t, buf));
      packets++;
      duration = t;
    },
    end() {
      clearInterval(timer);
      return new Promise(resolve => {
        const done = () => {
          if (!failed) {
            try {
              const fd = fs.openSync(file, 'r+');
              fs.writeSync(fd, headerLine({...header, packets, duration}), 0);
              fs.closeSync(fd);
            } catch (err) {
              fail(err);
            }
          }
          resolve({packets, duration, bytes});
        };
        if (closed) return done(); // the file already failed and closed
        out.on('close', done);
        brotli.end();
      });
    },
  };
}

// The header line at the start of a file, or null
function readHeader(buf) {
  const nl = buf.indexOf(10);
  try {
    const header = JSON.parse(buf.subarray(0, nl < 0 ? buf.length : nl).toString('utf8'));
    return header && header.type === 'f1rec' ? {header, bodyStart: nl < 0 ? buf.length : nl + 1} : null;
  } catch (err) {
    return null; // not JSON at all
  }
}

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

// The packet lines of a recording, decompressed: a Buffer (never one string, which caps out near 512 MB).
// A compressed recording cut short (the game or server crashed) still gives everything up to its last flush.
function recordingBody(file) {
  const buf = fs.readFileSync(file);
  const found = readHeader(buf);
  if (!found) throw new Error('Not a recording file (missing f1rec header)');
  let body = buf.subarray(found.bodyStart);
  if (found.header.compression === 'br') body = zlib.brotliDecompressSync(body, {finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH});
  return {header: found.header, body};
}

// Reads a recording of either version: {header, packets: [{t, buf}]}. Only a cut-off last line is skipped.
function loadRecording(file) {
  const {header, body} = recordingBody(file);
  const packets = [];
  for (let start = 0, line = 2; start < body.length; line++) {
    let end = body.indexOf(10, start);
    if (end < 0) end = body.length;
    if (end > start) {
      try {
        const [t, b64] = JSON.parse(body.toString('utf8', start, end));
        packets.push({t, buf: Buffer.from(b64, 'base64')});
      } catch (err) {
        if (end < body.length) throw new Error(`Damaged recording: line ${line} is not a packet`);
      }
    }
    start = end + 1;
  }
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

const SPEEDS = [0.25, 0.5, 1, 2, 3, 5, 10];

/**
 * A controllable player for a loaded recording: hands each packet to send(buf) at its original timing / speed.
 * Pause, resume, change speed, seek and loop all keep a single position clock (ms into the recording).
 * `now` and `timers` are injectable so tests can drive it without waiting.
 */
function createPlayer(packets, {send, speed = 1, loop = false, autoplay = true, now = Date.now, tickMs = 10} = {}) {
  const duration = packets[packets.length - 1].t;
  let playing = false, finished = false, rate = speed, looping = loop;
  let basePos = 0, baseAt = now(), next = 0, timer = null;

  const position = () => {
    if (!playing) return basePos;
    return Math.min(duration, basePos + (now() - baseAt) * rate);
  };
  const rebase = pos => { basePos = Math.max(0, Math.min(duration, pos)); baseAt = now(); };

  function tick() {
    if (!playing) return;
    const pos = position();
    while (next < packets.length && packets[next].t <= pos) send(packets[next++].buf);
    if (next >= packets.length) {
      if (looping) { rebase(0); next = 0; return; }
      basePos = duration;
      playing = false;
      finished = true;
      clearInterval(timer);
      timer = null;
    }
  }
  function startClock() {
    if (!timer) timer = setInterval(tick, tickMs);
  }

  const player = {
    play() {
      if (finished) { rebase(0); next = 0; finished = false; }
      if (playing) return;
      rebase(basePos);
      playing = true;
      startClock();
    },
    pause() {
      if (!playing) return;
      basePos = position();
      playing = false;
      clearInterval(timer);
      timer = null;
    },
    toggle() { if (playing) player.pause(); else player.play(); },
    setSpeed(x) {
      if (!(x > 0)) return;
      const pos = position();
      rebase(pos);
      rate = x;
    },
    setLoop(on) { looping = !!on; },
    // Jump to ms into the recording. The newest packet of each type before that point is replayed first, so
    // session, participants and the like are there even though they are only sent every few seconds.
    seek(ms) {
      const target = Math.max(0, Math.min(duration, ms));
      let i = packets.findIndex(p => p.t > target);
      if (i < 0) i = packets.length;
      const seen = new Set(), keyframes = [];
      for (let j = i - 1; j >= 0 && seen.size < 17; j--) {
        const id = packets[j].buf[6];
        if (!seen.has(id)) { seen.add(id); keyframes.push(packets[j].buf); }
      }
      keyframes.reverse().forEach(b => send(b));
      next = i;
      finished = false;
      rebase(target);
      if (playing) startClock();
    },
    skip(deltaMs) { player.seek(position() + deltaMs); },
    restart() { player.seek(0); },
    stop() { playing = false; clearInterval(timer); timer = null; },
    status() {
      return {playing, finished, speed: rate, loop: looping, pos: Math.round(position()), duration, packets: packets.length};
    },
    tick,
  };
  if (autoplay) player.play();
  return player;
}

module.exports = {
  parseArgs, loadRecording, recordingBody, readHeader, createRecordingWriter, headerLine, packetLine, isRecordingName,
  replay, createPlayer, SPEEDS, USAGE, REC_EXT, HEADER_BYTES,
};

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

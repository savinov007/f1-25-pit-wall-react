// Builds the shipped track maps (tracks/maps/<trackId>-<trackLength>.json) from recordings. Each recording is
// played through a dashboard, whose own track learning saves the outline, with its official corner numbers, once
// a whole lap is known. Tracks that already have a shipped map are left as they are.
// Usage: node scripts/build-tracks.js [recordings/a.f1rec ...]   (no files: every recording in recordings/)
const fs = require('fs');
const path = require('path');
const {createDashboard} = require('../server');
const {loadRecording, isRecordingName} = require('../replay');

const OUT = path.join(__dirname, '..', 'tracks', 'maps');
const quiet = {log() {}, warn() {}, error() {}};

// {track, file} when a map was written, {track, skipped} otherwise
function buildTrack(recording, {out = OUT, trackComplete} = {}) {
  const {packets} = loadRecording(recording);
  const dash = createDashboard({httpPort: 0, udpPort: 0, trackDir: out, bundledTrackDir: out, trackComplete, log: quiet});
  const had = new Set(fs.existsSync(out) ? fs.readdirSync(out) : []);
  let track = null;
  for (let i = 0; i < packets.length; i++) {
    dash.handlePacket(packets[i].buf);
    if (i % 20) continue; // learning every 20 packets is plenty: cars barely move between them
    const s = dash.refreshState();
    if (s.session) track = s.session.track;
    if (s.trackMap && s.trackMap.available) {
      const name = `${s.trackMap.trackId}-${s.trackMap.trackLength}.json`;
      return had.has(name) ? {track, skipped: 'already has a map'} : {track, file: path.join(out, name)};
    }
  }
  return {track, skipped: track ? 'no complete lap in this recording' : 'no session in this recording'};
}

function main(args, {dir = path.join(__dirname, '..', 'recordings'), out = OUT, log = console, trackComplete} = {}) {
  let files = args.filter(a => !a.startsWith('--'));
  if (!files.length) {
    try {
      files = fs.readdirSync(dir).filter(isRecordingName).sort().map(n => path.join(dir, n));
    } catch (err) {
      files = [];
    }
  }
  if (!files.length) log.log('No recordings to build track maps from');
  let failed = 0;
  for (const file of files) {
    try {
      const r = buildTrack(file, {out, trackComplete});
      const corners = r.file ? JSON.parse(fs.readFileSync(r.file, 'utf8')).corners.length : 0;
      log.log(r.file ? `${r.track}: ${path.basename(r.file)} (${corners} corners)` : `${path.basename(file)}: ${r.track ? r.track + ' ' : ''}${r.skipped}`);
    } catch (err) {
      failed++;
      log.error(`Could not read ${file}: ${err.message}`);
    }
  }
  return failed ? 1 : 0;
}

module.exports = {buildTrack, main};

if (require.main === module) process.exitCode = main(process.argv.slice(2));

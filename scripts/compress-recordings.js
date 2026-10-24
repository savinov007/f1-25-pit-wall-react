// Converts plain (.jsonl) recordings to compressed .f1rec ones, losslessly: the compressed file is read back and
// every packet (time and bytes) checked against the original before the original is removed.
// Usage: node scripts/compress-recordings.js [recordings/a.jsonl ...] [--keep]
//   no files: every .jsonl in recordings/; --keep: keep the originals next to the compressed copies.
const fs = require('fs');
const path = require('path');
const recording = require('../replay'); // used as recording.x so tests can stand in for a reader
const {createRecordingWriter, REC_EXT} = recording;

const sameData = (a, b) => a.length === b.length && a.every((p, i) => p.t === b[i].t && p.buf.equals(b[i].buf));

async function compressRecording(file, {keep = false} = {}) {
  if (!file.endsWith('.jsonl')) return {file, skipped: 'not a plain .jsonl recording'};
  const out = file.slice(0, -'.jsonl'.length) + REC_EXT;
  if (fs.existsSync(out)) return {file, skipped: `${path.basename(out)} already exists`};
  const st = fs.statSync(file);
  const {header, packets} = recording.loadRecording(file);
  const {type, version, ...fields} = header; // the new header has its own type and version
  const tmp = out + '.tmp';
  try {
    let error = null;
    const writer = createRecordingWriter(tmp, fields, {onError: err => { error = error || err; }});
    for (const p of packets) writer.write(p.t, p.buf);
    await writer.end();
    if (error) throw error;
    if (!sameData(recording.loadRecording(tmp).packets, packets)) throw new Error('the compressed copy does not match; original kept');
    fs.renameSync(tmp, out);
  } catch (err) {
    fs.rmSync(tmp, {force: true});
    throw err;
  }
  fs.utimesSync(out, st.atime, st.mtime); // same place in the newest-first replay list
  if (!keep) fs.unlinkSync(file);
  return {file, out, before: st.size, after: fs.statSync(out).size, packets: packets.length};
}

async function main(args, {dir = path.join(__dirname, '..', 'recordings'), log = console} = {}) {
  const keep = args.includes('--keep');
  let files = args.filter(a => !a.startsWith('--'));
  if (!files.length) {
    try {
      files = fs.readdirSync(dir).filter(n => n.endsWith('.jsonl')).sort().map(n => path.join(dir, n));
    } catch (err) {
      files = [];
    }
  }
  if (!files.length) log.log('No .jsonl recordings to compress');
  let before = 0, after = 0, failed = 0;
  for (const file of files) {
    try {
      const r = await compressRecording(file, {keep});
      if (r.skipped) { log.log(`Skipped ${file}: ${r.skipped}`); continue; }
      before += r.before;
      after += r.after;
      log.log(`${path.basename(r.out)}: ${mb(r.before)} -> ${mb(r.after)} (${(r.before / r.after).toFixed(1)}x smaller, ${r.packets} packets checked)`);
    } catch (err) {
      failed++;
      log.error(`Could not compress ${file}: ${err.message}`);
    }
  }
  if (before) log.log(`Total: ${mb(before)} -> ${mb(after)}${keep ? ' (originals kept)' : ''}`);
  return failed ? 1 : 0;
}
const mb = n => (n / 1048576).toFixed(1) + ' MB';

module.exports = {compressRecording, main};

if (require.main === module) main(process.argv.slice(2)).then(code => { process.exitCode = code; });

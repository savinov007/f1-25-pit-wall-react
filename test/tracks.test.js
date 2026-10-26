// Track map scripts: building the shipped maps from recordings, and the official corner data.
const {test, describe, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {FIXTURE} = require('./helpers');
const {buildTrack, main: buildMain} = require('../scripts/build-tracks');
const official = require('../scripts/fetch-official-corners');
const {constants} = require('../build/src');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pitwall-tracks-'));
after(() => fs.rmSync(dir, {recursive: true, force: true}));
const folder = () => fs.mkdtempSync(path.join(dir, 'd-'));
// the fixture is a couple of seconds of Catalunya: lowered limits make that "a whole lap"
const easy = {coverage: 0.01, maxGap: Infinity};
const quietLog = () => {
  const lines = [];
  return {lines, log: {log: m => lines.push(m), error: m => lines.push('ERROR ' + m)}};
};

describe('building shipped track maps', () => {
  test('a recording with a whole lap becomes <trackId>-<trackLength>.json; a second one is left alone', () => {
    const out = folder();
    const r = buildTrack(FIXTURE, {out, trackComplete: easy});
    assert.deepEqual(r, {track: 'Catalunya', file: path.join(out, '4-4664.json')});
    const map = JSON.parse(fs.readFileSync(r.file, 'utf8'));
    assert.equal(map.trackId, 4);
    assert.ok(map.points.length > 0 && Array.isArray(map.corners));
    assert.deepEqual(buildTrack(FIXTURE, {out, trackComplete: easy}), {track: 'Catalunya', skipped: 'already has a map'});
  });
  test('not a whole lap, or no session at all: nothing written', () => {
    const out = folder();
    assert.deepEqual(buildTrack(FIXTURE, {out}), {track: 'Catalunya', skipped: 'no complete lap in this recording'});
    const noSession = path.join(dir, 'nosession.jsonl');
    fs.writeFileSync(noSession, '{"type":"f1rec"}\n[0,"AA=="]\n');
    assert.deepEqual(buildTrack(noSession, {out}), {track: null, skipped: 'no session in this recording'});
    assert.deepEqual(fs.readdirSync(out), []);
  });
  test('the command builds every recording in the folder and reports each', () => {
    const recs = folder(), out = path.join(folder(), 'tracks');
    fs.copyFileSync(FIXTURE, path.join(recs, 'a.jsonl'));
    fs.copyFileSync(FIXTURE, path.join(recs, 'b.jsonl'));
    fs.writeFileSync(path.join(recs, 'c.jsonl'), 'not a recording\n');
    fs.writeFileSync(path.join(recs, 'notes.txt'), 'x');
    const {lines, log} = quietLog();
    assert.equal(buildMain([], {dir: recs, out, log, trackComplete: easy}), 1, 'one could not be read');
    assert.match(lines[0], /^Catalunya: 4-4664\.json \(\d+ corners\)$/);
    assert.equal(lines[1], 'b.jsonl: Catalunya already has a map');
    assert.match(lines[2], /^ERROR Could not read .*c\.jsonl: Not a recording file/);
    const empty = quietLog();
    assert.equal(buildMain([], {dir: path.join(recs, 'missing'), out, log: empty.log}), 0);
    assert.deepEqual(empty.lines, ['No recordings to build track maps from']);
    const named = quietLog();
    buildMain([FIXTURE], {out: folder(), log: named.log});
    assert.equal(named.lines[0], 'catalunya-f125.jsonl: Catalunya no complete lap in this recording');
  });
  test('the shipped maps are well formed', () => {
    const shipped = path.join(__dirname, '..', 'tracks', 'maps');
    const files = fs.readdirSync(shipped);
    assert.ok(files.length >= 7, files.join(','));
    for (const f of files) {
      const [id, len] = f.replace('.json', '').split('-').map(Number);
      const map = JSON.parse(fs.readFileSync(path.join(shipped, f), 'utf8'));
      assert.equal(map.trackId, id, f);
      assert.equal(map.trackLength, len, f);
      assert.ok(map.points.length >= len / 8 * 0.95, `${f}: an outline round the whole lap`);
      assert.ok(map.corners.length > 0, `${f}: has its corners`);
      assert.deepEqual(map.corners.map(c => c.d), [...map.corners.map(c => c.d)].sort((a, b) => a - b), `${f}: in lap order`);
    }
  });
});

describe('official corner data', () => {
  const api = {
    circuitName: 'Somewhere', x: [0, 10, 20, 30, 40], y: [5, 6, 7, 8, 9],
    corners: [{number: 2, length: 900, trackPosition: {x: 20.4, y: 7.6}}, {number: 1, letter: 'A', length: 100, trackPosition: {x: 0, y: 5}}],
  };
  test('a circuit: every other outline point, corners in lap order with their letters', () => {
    assert.deepEqual(official.toEntry('Somewhere', [99, 2025], api), {
      name: 'Somewhere', source: {circuitKey: 99, year: 2025, circuitName: 'Somewhere'},
      outline: [[0, 5], [20, 7], [40, 9]],
      corners: [{n: '1A', x: 0, y: 5}, {n: '2', x: 20, y: 8}],
    });
  });
  test('every circuit is a game track, and the command writes them by track id', async () => {
    for (const name of Object.keys(official.CIRCUITS)) assert.ok(constants.TRACKS.some(t => t.name === name), name);
    const out = path.join(folder(), 'official.json'), urls = [];
    const {log} = quietLog();
    const written = await official.main({fetchJson: async url => { urls.push(url); return api; }, log, out});
    assert.equal(urls.length, Object.keys(official.CIRCUITS).length);
    assert.equal(urls[0], 'https://api.multiviewer.app/api/v1/circuits/10/2025');
    assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')), JSON.parse(JSON.stringify(written)));
    assert.equal(written[0].name, 'Melbourne');
    assert.equal(written[32].name, 'Losail');
  });
  test('the committed data covers the current calendar', () => {
    const data = require('../tracks/official.json');
    for (const [id, c] of Object.entries(data)) {
      assert.equal(constants.TRACKS[id].name, c.name);
      assert.ok(c.outline.length > 50 && c.corners.length >= 10, c.name);
    }
    assert.equal(data[5].corners.length, 19, 'Monaco');
    assert.deepEqual(data[9].corners.map(c => c.n).filter(n => /[A-Z]/.test(n)), ['1A', '12A'], 'Hungaroring');
  });
});

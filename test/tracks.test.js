// The official corner data and the script that fetches it.
const {test, describe, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const official = require('../scripts/fetch-official-corners');
const {constants} = require('../build/src');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pitwall-tracks-'));
after(() => fs.rmSync(dir, {recursive: true, force: true}));
const folder = () => fs.mkdtempSync(path.join(dir, 'd-'));
const quietLog = () => {
  const lines = [];
  return {lines, log: {log: m => lines.push(m), error: m => lines.push('ERROR ' + m)}};
};

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

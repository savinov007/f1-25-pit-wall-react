// Fetches the official corner numbers (and each circuit's reference outline, used to place them on the game's own
// outline) from the MultiViewer circuits API, the F1 live-timing circuit data that FastF1 also uses.
// Writes tracks/official.json. Run again only to pick up new circuits: npm run tracks:fetch-official
const fs = require('fs');
const path = require('path');
const {constants} = require('../build/src');

// game track name -> [MultiViewer circuit key, season to take the layout from]
const CIRCUITS = {
  Melbourne: [10, 2025], Shanghai: [49, 2025], Sakhir: [63, 2025], Catalunya: [15, 2025], Monaco: [22, 2025],
  Montreal: [23, 2025], Silverstone: [2, 2025], Hungaroring: [4, 2025], Spa: [7, 2025], Monza: [39, 2025],
  Singapore: [61, 2025], Suzuka: [46, 2025], 'Abu Dhabi': [70, 2025], Texas: [9, 2025], Brazil: [14, 2025],
  Austria: [19, 2025], Sochi: [79, 2021], Mexico: [65, 2025], Baku: [144, 2025], Zandvoort: [55, 2025],
  Imola: [6, 2025], Jeddah: [149, 2025], Miami: [151, 2025], 'Las Vegas': [152, 2025], Losail: [150, 2025],
};
const OUT = path.join(__dirname, '..', 'tracks', 'official.json');

// One circuit as stored: the outline (every other point is plenty to fit on) and the corners, labelled like the
// official maps ('1', '12A').
function toEntry(name, [circuitKey, year], api) {
  const outline = api.x.map((x, i) => [Math.round(x), Math.round(api.y[i])]).filter((p, i) => i % 2 === 0);
  const corners = [...api.corners]
    .sort((a, b) => a.length - b.length)
    .map(c => ({n: `${c.number}${c.letter || ''}`, x: Math.round(c.trackPosition.x), y: Math.round(c.trackPosition.y)}));
  return {name, source: {circuitKey, year, circuitName: api.circuitName}, outline, corners};
}

async function main({fetchJson = defaultFetch, log = console, out = OUT} = {}) {
  const official = {};
  for (const [name, source] of Object.entries(CIRCUITS)) {
    const trackId = constants.TRACKS.findIndex(t => t.name === name);
    if (trackId < 0) throw new Error(`No game track called ${name}`);
    const api = await fetchJson(`https://api.multiviewer.app/api/v1/circuits/${source[0]}/${source[1]}`);
    official[trackId] = toEntry(name, source, api);
    log.log(`${name}: ${official[trackId].corners.length} corners`);
  }
  fs.mkdirSync(path.dirname(out), {recursive: true});
  fs.writeFileSync(out, JSON.stringify(official) + '\n');
  return official;
}
async function defaultFetch(url) {
  const res = await fetch(url, {headers: {'user-agent': 'f1-pit-wall'}});
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await new Promise(r => setTimeout(r, 250)); // gently
  return res.json();
}

module.exports = {CIRCUITS, toEntry, main};

if (require.main === module) main().catch(err => { console.error(err.message); process.exitCode = 1; });

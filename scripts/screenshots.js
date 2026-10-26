// Regenerates the README screenshots in docs/ from demo data and the test fixture (no private recordings):
//   npm run build:web && node scripts/screenshots.js        (needs Google Chrome)
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawn} = require('child_process');
const WebSocket = require('ws');
const {createDashboard} = require('../server');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs');
const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'catalunya-f125.jsonl');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
// the live traces keep 10 s (driving, popup) and 20 s (compare); wait that long so the charts are full
const TRACE_MS = 11000, COMPARE_MS = 21000, LAPS_MS = 61000;
const quiet = {log() {}, warn() {}, error() {}};

async function main() {
  fs.mkdirSync(OUT, {recursive: true});
  const recDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pitwall-shots-'));
  fs.copyFileSync(FIXTURE, path.join(recDir, 'session-2026-01-01T12-00-00-000Z.jsonl'));
  const mk = opts => createDashboard({httpPort: 0, udpPort: 0, recDir, log: quiet, ...opts});
  const demo = mk({demo: true}), replay = mk({replayFile: FIXTURE}), live = mk({});
  for (const d of [demo, replay, live]) await d.start();

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pitwall-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${profile}`, '--hide-scrollbars',
    '--window-size=1600,900', 'about:blank'], {stdio: 'ignore'});
  let targets;
  for (let i = 0; i < 50 && !targets; i++) {
    await sleep(200);
    try { targets = await (await fetch('http://127.0.0.1:9333/json')).json(); } catch (err) { /* not up yet */ }
  }
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.once('open', r));
  let id = 0;
  const pending = new Map();
  ws.on('message', m => { const d = JSON.parse(m); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
  const cdp = (method, params = {}) => new Promise(r => { pending.set(++id, r); ws.send(JSON.stringify({id, method, params})); });
  const js = async expr => (await cdp('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true})).result.result.value;
  const open = async (port, w = 1600, h = 900) => {
    await cdp('Emulation.setDeviceMetricsOverride', {width: w, height: h, deviceScaleFactor: 1, mobile: false});
    await cdp('Page.navigate', {url: `http://localhost:${port}/`});
    await sleep(1800);
  };
  const shot = async name => {
    const {result} = await cdp('Page.captureScreenshot', {format: 'png'});
    fs.writeFileSync(path.join(OUT, name), Buffer.from(result.data, 'base64'));
    console.log('wrote docs/' + name);
  };

  try {
    // the page is driven through its own controls, as a user would
    const click = sel => js(`document.querySelector(${JSON.stringify(sel)}).click()`);

    // demo dashboard with a rival popup
    await open(demo.ports.http);
    await sleep(TRACE_MS);
    await shot('dashboard.png');
    await click('.srow[data-idx="3"]');
    await sleep(TRACE_MS);
    await shot('rival-popup.png');
    await click('.dmclose');

    // compare mode with three drivers (it opens with you and the car ahead: swap them for the top three)
    await click('.comparebtn');
    await sleep(400);
    for (const idx of [2, 1, 0, 1, 2]) await click(`.pchip[data-idx="${idx}"]`);
    await sleep(COMPARE_MS);
    await shot('compare.png');

    // the same drivers plotted by lap distance (throttle, last lap) once each has a whole lap recorded:
    // the page joined mid-lap, so wait for two 30 s demo laps
    await click('.cmpaxis [data-a=dist]');
    await click('.cmplap [data-l=last]');
    await click('.cmpmetric [data-m=thr]');
    await sleep(LAPS_MS);
    await shot('compare-lap.png');

    // waiting screen with the format picker, showing a placeholder instead of this machine's real LAN address
    // and the default port (the server refreshes its addresses every second, so keep them overridden)
    const placeholder = setInterval(() => { live.state.setup = {...live.state.setup, ips: [{name: 'en0', address: '192.168.1.42'}], udpPort: 20777}; }, 50);
    await open(live.ports.http);
    await click('.fmtpick [data-format="2026"]');
    await sleep(300);
    await shot('waiting.png');

    // saved replays list
    await click('.waitreplay');
    await sleep(900);
    await shot('replays.png');
    clearInterval(placeholder);

    // replay mode: paused a second in
    await open(replay.ports.http);
    await click('.rp [title="Back to start"]');
    await sleep(1000);
    await click('.rpplay');
    await sleep(900);
    await shot('replay.png');
  } finally {
    ws.close();
    chrome.kill();
    for (const d of [demo, replay, live]) await d.stop();
    fs.rmSync(recDir, {recursive: true, force: true});
    fs.rmSync(profile, {recursive: true, force: true});
  }
}
main().catch(err => { console.error(err); process.exit(1); });

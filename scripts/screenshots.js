// Regenerates the README screenshots in docs/ from demo data and the test fixture (no private recordings):
//   node scripts/screenshots.js        (needs Google Chrome)
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
const TRACE_MS = 11000, COMPARE_MS = 21000;
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
    // demo dashboard with a rival popup
    await open(demo.ports.http);
    await sleep(TRACE_MS);
    await shot('dashboard.png');
    await js('openDriver(3)');
    await sleep(TRACE_MS);
    await shot('rival-popup.png');
    await js('closeDriver()');

    // compare mode with three drivers
    await js('document.getElementById("compareBtn").click()');
    await sleep(400);
    await js('cmpSel = []; [0, 1, 2].forEach(i => toggleCompare(i))');
    await sleep(COMPARE_MS);
    await shot('compare.png');

    // the same drivers plotted by lap distance (throttle, last lap) once each has a completed lap
    await js('document.querySelector("#cmpAxis [data-a=dist]").click(); document.querySelector("#cmpLap [data-l=last]").click(); document.querySelector("#cmpMetric [data-m=thr]").click()');
    // 'last' must cover (nearly) the whole 5 km demo lap, not just the part seen after the page loaded mid-lap
    const fullLap = '[0, 1, 2].every(i => { const t = lapTraces.get(i); return t && t.last && t.last.length > 20 && t.last[t.last.length - 1].d - t.last[0].d > 4500; })';
    for (let i = 0; i < 120 && !(await js(fullLap)); i++) await sleep(1000);
    await sleep(500);
    await shot('compare-lap.png');

    // waiting screen with the format picker
    await open(live.ports.http);
    // show a placeholder instead of this machine's real LAN address, and the default port
    await js('{ const orig = renderWait; renderWait = s => { orig(s); document.getElementById("waitIp").textContent = "192.168.1.42"; document.getElementById("waitPort").textContent = "20777"; }; }');
    await js('document.querySelector("#fmtPick [data-format=\\"2026\\"]").click()');
    await sleep(300);
    await shot('waiting.png');

    // saved replays list
    await js('document.getElementById("waitReplays").click()');
    await sleep(900);
    await shot('replays.png');

    // replay mode: paused a second in
    await open(replay.ports.http);
    await js('rpSend("seek", 1000); rpSend("pause")');
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

// The dashboard page (index.html + lib.js + app.js) in jsdom, driven by server messages.
// State comes from the demo generator at t = 45 s (lap 2, mid-lap, flat out on a straight).
const {test, describe, afterEach} = require('node:test');
const assert = require('node:assert/strict');
const {loadPage, dashboardState} = require('./helpers');

// every page is closed after its test, even when an assertion fails
const pages = [];
afterEach(() => pages.splice(0).forEach(p => p.close()));
async function boot(opts) {
  const p = loadPage(opts);
  pages.push(p);
  await p.tick(5); // socket opens
  return p;
}
// visible text with a space between elements (textContent runs adjacent elements together)
function text(el) {
  const parts = [];
  const walk = n => {
    if (n.nodeType === 3) parts.push(n.textContent.trim());
    else n.childNodes.forEach(walk);
  };
  walk(el);
  return parts.filter(Boolean).join(' ');
}
// a page value copied into this realm, so deepEqual can compare it
const json = (p, code) => JSON.parse(JSON.stringify(p.eval(code)));
const detailFor = (s, idx) => ({idx, telemetry: s.telemetry, status: s.status, damage: s.damage, lap: s.lap, motion: s.motion});

describe('connection', () => {
  test('announces no driver and no comparison when the socket opens', async () => {
    const p = await boot();
    assert.deepEqual(p.sent(), [{select: null}, {compare: []}]);
    assert.equal(p.socket().url, 'ws://localhost:3000');
    p.close();
  });
  test('status: live, paused, waiting, offline with reconnect', async () => {
    const p = await boot();
    p.push(dashboardState());
    assert.equal(p.$('connText').textContent, 'LIVE');
    assert.equal(p.$('dot').className, 'dot live');
    p.push(dashboardState({connected: false}));
    assert.equal(p.$('connText').textContent, 'NO SIGNAL — PAUSED?');
    assert.equal(p.$('dot').className, 'dot idle');
    p.push(dashboardState({connected: false, hasData: false}));
    assert.equal(p.$('connText').textContent, 'WAITING FOR GAME');
    assert.equal(p.$('pps').textContent, '20');
    p.socket().close();
    assert.equal(p.$('connText').textContent, 'SERVER OFFLINE — RETRYING');
    await p.tick(1600);
    assert.equal(p.sockets.length, 2, 'reconnected');
    p.close();
  });
});

describe('setup overlay', () => {
  test('shows the IP and port to enter in the game until data arrives', async () => {
    const p = await boot();
    const ips = [{name: 'en0', address: '192.168.8.131'}, {name: 'en5', address: '10.0.0.4'}];
    p.push(dashboardState({hasData: false, setup: {ips, udpPort: 20799, demo: false}}));
    assert.equal(p.$('wait').hidden, false);
    assert.equal(p.$('waitIp').textContent, '192.168.8.131');
    assert.equal(p.$('waitPort').textContent, '20799');
    assert.equal(p.$('waitAlt').textContent, 'Other addresses: 10.0.0.4 (en5)');
    p.push(dashboardState({hasData: false, setup: {ips: [], udpPort: 20777}}));
    assert.equal(p.$('waitIp').textContent, 'no network found');
    p.push(dashboardState({hasData: true, connected: false}));
    assert.equal(p.$('wait').hidden, true, 'stays closed while paused');
    p.close();
  });

  const waiting = {hasData: false, setup: {ips: [{name: 'en0', address: '10.0.0.4'}], udpPort: 20777}};
  const pick = (p, format) => p.doc.querySelector(`#fmtPick [data-format="${format}"]`);

  test('asks which telemetry format to use before showing the game settings', async () => {
    const p = await boot();
    p.push(dashboardState(waiting));
    assert.equal(p.$('setupList').hidden, true, 'settings wait for a choice');
    assert.equal(p.$('setupHint').hidden, true);
    assert.equal(p.$('fmtPick').classList.contains('need'), true);
    pick(p, 2026).click();
    assert.equal(p.$('setupList').hidden, false);
    assert.equal(p.$('waitFormat').textContent, '2026 (F1 26)');
    assert.equal(pick(p, 2026).classList.contains('on'), true);
    assert.equal(pick(p, 2025).classList.contains('on'), false);
    assert.equal(p.$('fmtPick').classList.contains('need'), false);
    pick(p, 2025).click();
    assert.equal(p.$('waitFormat').textContent, '2025 (F1 25)');
    assert.equal(pick(p, 2026).classList.contains('on'), false);
  });

  test('remembers the chosen format', async () => {
    const p = await boot();
    pick(p, 2025).click();
    assert.equal(p.w.localStorage.getItem('pitwall-format'), '2025');
    const q = await boot({storage: {'pitwall-format': '2026'}});
    q.push(dashboardState(waiting));
    assert.equal(q.$('setupList').hidden, false, 'no need to choose again');
    assert.equal(q.$('waitFormat').textContent, '2026 (F1 26)');
    const bad = await boot({storage: {'pitwall-format': 'nope'}});
    bad.push(dashboardState(waiting));
    assert.equal(bad.$('setupList').hidden, true, 'an invalid stored value counts as no choice');
  });

  test('warns once when the game sends another format than the chosen one', async () => {
    const p = await boot({storage: {'pitwall-format': '2025'}});
    const s = dashboardState();
    p.push({...s, session: {...s.session, packetFormat: 2025}});
    assert.equal(p.$('toast').hidden, true, 'matching format: no warning');
    p.push(s); // demo frames are format 2026
    assert.equal(p.$('toast').hidden, false);
    assert.match(p.$('toast').textContent, /sending UDP format 2026, not 2025/);
    p.$('toast').hidden = true;
    p.push(s);
    assert.equal(p.$('toast').hidden, true, 'not repeated');
    const none = await boot();
    none.push(s);
    assert.equal(none.$('toast').hidden, true, 'no choice made: nothing to compare');
  });
});

describe('session header and driving', () => {
  test('track, weather and temperatures', async () => {
    const p = await boot();
    p.push(dashboardState());
    assert.equal(p.$('track').textContent, 'Demo Circuit');
    assert.equal(p.$('weather').textContent, 'Clear');
    assert.equal(p.$('trackTemp').textContent, '34');
    assert.equal(p.$('airTemp').textContent, '24');
    p.close();
  });
  test('speed, gear, rpm, DRS, rev lights, pedals and steering', async () => {
    const p = await boot();
    const s = dashboardState();
    p.push(s);
    assert.equal(p.$('speed').textContent, '310');
    assert.equal(p.$('gear').textContent, '8');
    assert.equal(p.$('rpm').textContent, String(s.telemetry.m_engineRPM));
    assert.equal(p.doc.querySelectorAll('#rev i.on').length, 11, '75% of 15 LEDs');
    assert.equal(p.$('thr').style.height, '100%');
    assert.equal(p.$('brk').style.height, '0%');
    p.push(dashboardState({telemetry: {...s.telemetry, m_gear: 0, m_drs: 1}, telemetry2: null}));
    assert.equal(p.$('drs').classList.contains('on'), true);
    assert.equal(p.$('gear').textContent, 'N');
    p.push(dashboardState({telemetry: {...s.telemetry, m_gear: -1, m_drs: 0, m_steer: -1}, telemetry2: null}));
    assert.equal(p.$('gear').textContent, 'R');
    assert.equal(p.$('drs').textContent, 'DRS', 'pre-2026 cars show DRS');
    assert.equal(p.$('drs').classList.contains('on'), false);
    assert.equal(p.$('steer').style.left, '5%');
    assert.equal(p.eval('samples.length'), 3, 'pedal trace samples');
    p.close();
  });
});

describe('tyres and car', () => {
  test('wear per corner (game order RL RR FL FR), colours and tread drain', async () => {
    const p = await boot();
    p.push(dashboardState()); // wear [24, 28, 43, 66]
    const wear = c => p.doc.querySelector(`#tyregrid .ti.${c} .ti-wear b`).textContent;
    assert.deepEqual(['fl', 'fr', 'rl', 'rr'].map(wear), ['43', '66', '24', '28']);
    assert.equal(p.doc.querySelector('#tyregrid .ti.fr .ti-wear').style.color, 'rgb(255, 45, 31)', '66% is red');
    assert.equal(p.doc.querySelector('#tyregrid .ti.rl .ti-wear').style.color, 'rgb(31, 209, 102)', '24% is green');
    const worn = p.doc.querySelectorAll('#tyregrid .worn');
    assert.equal(Number(worn[1].getAttribute('height')).toFixed(2), (42 * 0.66).toFixed(2), 'FR tread drained 66%');
    const fl = p.doc.querySelectorAll('#tyregrid .ti.fl dd');
    assert.deepEqual([...fl].map(d => d.textContent), ['90°', '96°', '23.4', '380°']);
    p.close();
  });
  test('compound, fuel and ERS', async () => {
    const p = await boot();
    p.push(dashboardState());
    assert.equal(p.$('cname').textContent, 'Medium');
    assert.equal(p.$('cage').textContent, '2 laps');
    assert.match(p.$('fuelTxt').textContent, /^\d+\.\d KG$/);
    assert.equal(p.$('fuelLaps').textContent, '+0.80 laps');
    assert.equal(p.$('ersTxt').textContent, '50%');
    assert.equal(p.$('ersMode').textContent, 'Hotlap · 8.5 MJ/lap', 'mode plus the 2026 harvest limit');
    assert.ok(Math.abs(parseFloat(p.$('ers').style.width) - 50) < 1e-6);
    p.close();
  });
  test('damage tiles and highlighted car parts', async () => {
    const p = await boot();
    p.push(dashboardState());
    const tiles = [...p.doc.querySelectorAll('#dmg .dc')].map(el => [el.querySelector('span').textContent, el.className, el.querySelector('b').firstChild.textContent]);
    assert.deepEqual(tiles, [
      ['FL wing', 'dc l1', '12'], ['FR wing', 'dc l0', '0'], ['Rear wing', 'dc l0', '0'], ['Floor', 'dc l1', '4'],
      ['Diffuser', 'dc l0', '0'], ['Sidepods', 'dc l2', '27'], ['Gearbox', 'dc l0', '0'], ['Engine', 'dc l1', '3'],
    ]);
    assert.match(p.doc.querySelector('#tyregrid .spl').style.fill, /^rgba\(255, 122, 26, 0?\.85\)$/);
    assert.equal(p.doc.querySelector('#tyregrid .rw').style.fill, '');
    p.close();
  });
});

describe('lap timing', () => {
  test('position, lap, times, sectors and best lap', async () => {
    const p = await boot();
    const s = dashboardState();
    p.push(s);
    assert.equal(p.$('pos').textContent, '3');
    assert.equal(p.$('lapNum').textContent, '2');
    assert.equal(p.$('totalLaps').textContent, '30');
    assert.equal(p.$('cur').textContent, '0:15.000');
    assert.equal(p.$('last').textContent, '0:29.880');
    assert.equal(p.$('best').textContent, '0:29.880');
    assert.equal(text(p.$('s1')), 'S1 9.800');
    assert.equal(p.$('s2').classList.contains('active'), true);
    p.push(dashboardState({lap: {...s.lap, m_lastLapTimeInMS: 31000}}));
    assert.equal(p.$('best').textContent, '0:29.880', 'slower lap keeps the best');
    p.push(dashboardState({lap: {...s.lap, m_lastLapTimeInMS: 29000, m_sector: 2, m_sector2TimeInMS: 10000, m_currentLapTimeInMS: 25000}}));
    assert.equal(p.$('best').textContent, '0:29.000');
    assert.equal(text(p.$('s3')), 'S3 5.200', 'S3 = current lap - S1 - S2');
    assert.equal(p.$('invalid').hidden, true);
    p.push(dashboardState({lap: {...s.lap, m_currentLapInvalid: 1, m_pitStatus: 1}}));
    assert.equal(p.$('invalid').hidden, false);
    assert.equal(p.$('pit').hidden, false);
    p.close();
  });
});

describe('standings', () => {
  const rowsText = p => [...p.doc.querySelectorAll('.srow')].map(r => r.querySelector('.n').textContent.trim());
  test('rows in position order with player, pit, penalty and retired markers', async () => {
    const p = await boot();
    const s = dashboardState();
    s.rivals[12].result = 4;
    p.push(s);
    const rows = p.doc.querySelectorAll('.srow');
    assert.equal(rows.length, 13);
    assert.equal(rows[2].classList.contains('me'), true);
    assert.equal(rows[0].querySelector('.g').textContent, 'LEADER');
    assert.match(rows[7].querySelector('.n').innerHTML, /tag pit/);
    assert.match(rows[5].querySelector('.n').textContent, /HAMILTON\+5s/);
    assert.equal(rows[12].classList.contains('out'), true);
    assert.equal(rows[12].querySelector('.g').textContent, 'OUT');
    assert.equal(rowsText(p)[0], 'VERSTAPPEN');
    p.push(dashboardState({rivals: []}));
    assert.equal(text(p.$('rows')), 'No rivals yet');
    p.close();
  });
  test('interval / leader gap toggle', async () => {
    const p = await boot();
    const s = dashboardState();
    p.push(s);
    const gap1 = () => p.doc.querySelectorAll('.srow')[1].querySelector('.g').textContent;
    assert.equal(gap1(), '+' + (s.rivals[1].gapFront / 1000).toFixed(3));
    p.$('gapMode').click();
    assert.equal(p.$('gapMode').textContent, 'LEADER');
    assert.equal(gap1(), '+' + (s.rivals[1].gapLeader / 1000).toFixed(3));
    p.close();
  });
  test('LAST / BEST toggle: delta to the fastest lap, remembered', async () => {
    const p = await boot();
    const s = dashboardState();
    p.push(s);
    p.$('lapMode').click();
    assert.equal(p.$('lapMode').textContent, 'BEST');
    assert.equal(p.$('gapHead').textContent, 'Δ BEST');
    assert.equal(p.$('gapMode').disabled, true);
    const fastest = Math.min(...s.rivals.map(r => r.best));
    const rows = [...p.doc.querySelectorAll('.srow')];
    const fastestRows = rows.filter(r => r.querySelector('.g').textContent === 'FASTEST');
    assert.ok(fastestRows.length >= 1);
    assert.ok(fastestRows.every(r => r.querySelector('.l').classList.contains('fastest')));
    const other = s.rivals.findIndex(r => r.best !== fastest);
    assert.equal(rows[other].querySelector('.g').textContent, '+' + ((s.rivals[other].best - fastest) / 1000).toFixed(3));
    assert.equal(p.w.localStorage.getItem('pitwall-lapmode'), 'best');
    p.close();
    const again = await boot({storage: {'pitwall-lapmode': 'best'}});
    assert.equal(again.$('lapMode').textContent, 'BEST');
    again.close();
  });
  test('restricted players show their race number', async () => {
    const p = await boot();
    const s = dashboardState();
    Object.assign(s.rivals[6], {name: 'Player', human: true, telemetryPublic: false, num: 24});
    p.push(s);
    assert.equal(p.doc.querySelectorAll('.srow')[6].querySelector('.n').textContent.trim(), 'Player#24');
    p.close();
  });
});

describe('rival popup', () => {
  test('opens on a row, asks the server for that car, shows its data', async () => {
    const p = await boot();
    const s = dashboardState();
    p.push(s);
    p.pointer(p.doc.querySelectorAll('.srow')[1], 'pointerdown');
    assert.equal(p.$('dm').hidden, false);
    assert.deepEqual(p.sent().at(-1), {select: 1});
    assert.equal(p.$('dmNote').textContent, "Waiting for this car's data…");
    p.push({...s, detail: detailFor(s, 1)});
    assert.equal(p.$('dmName').textContent, 'NORRIS');
    assert.equal(p.$('dmTeam').textContent, '#11 · McLaren');
    assert.equal(p.$('dmPos').textContent, '2');
    assert.equal(p.$('dmSpeed').textContent, '310');
    assert.equal(p.$('dmLap').textContent, '2 / 30');
    assert.equal(p.$('dmNote').hidden, true);
    assert.match(text(p.$('dmStrat')), /^Strategy \d+ laps to 70%/);
    assert.equal(p.doc.querySelectorAll('#dmTyres .ti').length, 4);
    assert.equal(p.doc.querySelectorAll('#dmDmg .dc').length, 8);
    p.close();
  });
  test('explains restricted telemetry', async () => {
    const p = await boot();
    const s = dashboardState();
    s.rivals[1].telemetryPublic = false;
    p.push(s);
    p.pointer(p.doc.querySelectorAll('.srow')[1], 'pointerdown');
    p.push({...s, detail: {...detailFor(s, 1), telemetry: {...s.telemetry, m_speed: 0, m_engineRPM: 0}}});
    assert.match(p.$('dmNote').textContent, /Restricted/);
    p.close();
  });
  test('Escape and ✕ close it and tell the server', async () => {
    const p = await boot();
    p.push(dashboardState());
    p.pointer(p.doc.querySelectorAll('.srow')[3], 'pointerdown');
    p.key(p.doc, 'Escape');
    assert.equal(p.$('dm').hidden, true);
    assert.deepEqual(p.sent().at(-1), {select: null});
    p.pointer(p.doc.querySelectorAll('.srow')[3], 'pointerdown');
    p.$('dmClose').click();
    assert.equal(p.$('dm').hidden, true);
    p.close();
  });
});

describe('compare mode', () => {
  const cols = p => [...p.doc.querySelectorAll('.cc')];
  test('defaults to you and the car ahead, and subscribes', async () => {
    const p = await boot();
    p.push(dashboardState());
    p.$('compareBtn').click();
    assert.equal(p.$('cmp').hidden, false);
    assert.deepEqual(json(p, 'cmpSel'), [2, 1]);
    assert.deepEqual(p.sent().at(-1), {compare: [2, 1]});
    assert.equal(cols(p).length, 2);
    assert.equal(p.doc.querySelectorAll('.pchip.on').length, 2);
    p.close();
  });
  test('picker adds and removes drivers, up to four', async () => {
    const p = await boot();
    p.push(dashboardState());
    p.$('compareBtn2').click();
    const chip = idx => p.doc.querySelector(`.pchip[data-idx="${idx}"]`);
    p.pointer(chip(0), 'pointerdown');
    p.pointer(chip(5), 'pointerdown');
    assert.deepEqual(json(p, 'cmpSel'), [2, 1, 0, 5]);
    assert.equal(chip(7).disabled, true, 'fifth driver is blocked');
    p.pointer(chip(7), 'pointerdown');
    assert.equal(json(p, 'cmpSel').length, 4);
    p.pointer(chip(0), 'pointerdown');
    assert.deepEqual(json(p, 'cmpSel'), [2, 1, 5]);
    cols(p)[1].querySelector('.ccx').click();
    assert.deepEqual(json(p, 'cmpSel'), [2, 5]);
    assert.deepEqual(p.sent().at(-1), {compare: [2, 5]});
    p.close();
  });
  test('columns show each driver, the delta to the reference and the faster laps', async () => {
    const p = await boot();
    const s = dashboardState();
    p.push(s);
    p.$('compareBtn').click();
    p.push({...s, compare: [detailFor(s, 2), detailFor(s, 1)]});
    const [you, nor] = cols(p);
    assert.equal(you.querySelector('.ccname').textContent, 'YOU');
    assert.equal(you.querySelector('.ccvsl').textContent, 'REFERENCE');
    assert.equal(nor.querySelector('.ccname').textContent, 'NORRIS');
    assert.equal(nor.querySelector('.ccvsl').textContent, 'VS YOU');
    const delta = s.rivals[1].gapLeader - s.rivals[2].gapLeader;
    assert.equal(nor.querySelector('.ccvs').textContent, '−' + Math.abs(delta / 1000).toFixed(3));
    assert.equal(nor.querySelector('.ccvs').classList.contains('ahead'), true);
    assert.equal(nor.querySelector('.cclast').classList.contains('purple'), true, 'NORRIS has the faster last lap');
    assert.equal(you.querySelector('.ccspd').textContent, '310');
    assert.equal(you.querySelector('.ccthrv').textContent, '100%');
    assert.equal(you.querySelectorAll('.ti').length, 4, 'same car diagram as the dashboard');
    assert.equal(you.querySelectorAll('.dc').length, 8);
    assert.match(text(you.querySelector('.ccstrat')), /^Strategy/);
    p.close();
  });
  test('chart toggles and lap-synced traces', async () => {
    const p = await boot();
    const s = dashboardState();
    p.push(s);
    p.$('compareBtn').click();
    p.doc.querySelector('#cmpAxis [data-a="dist"]').click();
    assert.equal(p.$('cmpLap').hidden, false);
    assert.equal(p.$('cmpChartLbl').textContent, 'Lap-synced trace · by distance');
    p.doc.querySelector('#cmpLap [data-l="last"]').click();
    assert.equal(p.eval('cmpLapView'), 'last');
    p.doc.querySelector('#cmpMetric [data-m="thr"]').click();
    assert.equal(p.eval('cmpMetric'), 'thr');
    assert.equal(p.doc.querySelector('#cmpMetric .on').dataset.m, 'thr');
    p.push({...s, compare: [detailFor(s, 2)]});
    assert.equal(p.eval('lapTraces.get(2).cur.length'), 1);
    assert.equal(p.eval('cmpTrails.get(2).length'), 1);
    p.doc.querySelector('#cmpAxis [data-a="time"]').click();
    assert.equal(p.$('cmpLap').hidden, true);
    p.close();
  });
  test('opening from the popup adds that driver; Escape closes and unsubscribes', async () => {
    const p = await boot();
    p.push(dashboardState());
    p.pointer(p.doc.querySelectorAll('.srow')[6], 'pointerdown');
    p.$('dmCompare').click();
    assert.equal(p.$('dm').hidden, true);
    assert.deepEqual(json(p, 'cmpSel'), [2, 6]);
    p.key(p.doc, 'Escape');
    assert.equal(p.$('cmp').hidden, true);
    assert.deepEqual(p.sent().at(-1), {compare: []});
    p.close();
  });
});

describe('strategy panel', () => {
  test('tyre projection, pit, pace and battles for your car', async () => {
    const p = await boot();
    p.push(dashboardState());
    const t = text(p.$('strat'));
    assert.match(t, /17 laps until FR hits 70% box ≈ L19/);
    assert.match(t, /FL 19 2\.70%\/lap/);
    assert.match(t, /Game pit window L14 – L19/);
    assert.match(t, /Game rejoin estimate P7/);
    assert.match(t, /Pit loss · measured 21\.4s 3 stops/);
    assert.match(t, /Pit now → P13 behind HULKENBERG 8\.40s/);
    assert.match(t, /Fuel margin \+0\.80 laps/);
    assert.match(t, /1:30\.360 avg \+0\.11s per lap slower/);
    assert.match(t, /AHEAD NORRIS \+0\.98s catching 0\.06s\/lap · in DRS range/);
    assert.match(t, /BEHIND LECLERC −[\d.]+s dropping back 0\.24s\/lap/);
    assert.equal(p.doc.querySelectorAll('.sbars i').length, 5);
    p.close();
  });
  test('the PIT AT limit changes the projection and is remembered', async () => {
    const p = await boot();
    p.push(dashboardState());
    p.$('wearLimit').value = '60';
    p.$('wearLimit').dispatchEvent(new p.w.Event('change'));
    assert.match(text(p.$('strat')), /13 laps until FR hits 60% box ≈ L15/);
    assert.equal(p.w.localStorage.getItem('pitwall-wearlimit'), '60');
    p.close();
    const again = await boot({storage: {'pitwall-wearlimit': '80'}});
    assert.equal(again.$('wearLimit').value, '80');
    again.close();
  });
  test('says what it is waiting for', async () => {
    const p = await boot();
    const s = dashboardState({pitLoss: null, status: null});
    Object.assign(s.rivals[2].strategy, {wearRate: null, pace: null, gapTrend: null});
    p.push(s);
    const t = text(p.$('strat'));
    assert.match(t, /Measuring wear rate/);
    assert.match(t, /measured after the first stop by any car/);
    assert.match(t, /Needs a clean lap/);
    assert.match(t, /measuring…/);
    p.push(dashboardState({rivals: []}));
    assert.equal(text(p.$('strat')), 'Waiting for data');
    p.close();
  });
});

describe('recording', () => {
  test('button state, elapsed time, and the saved-file message', async () => {
    const p = await boot();
    p.push(dashboardState({recording: {available: false, active: false}}));
    assert.equal(p.$('rec').disabled, true);
    p.push(dashboardState());
    p.$('rec').click();
    assert.deepEqual(p.sent().at(-1), {record: true});
    p.push(dashboardState({recording: {available: true, active: true, seconds: 75, packets: 12345}}));
    assert.equal(p.$('recText').textContent, '1:15 · 12,345 pkts');
    assert.equal(p.$('rec').classList.contains('on'), true);
    p.push(dashboardState({recording: {available: true, active: false, lastFile: 'recordings/a.jsonl', lastBytes: 2097152, lastPackets: 900}}));
    assert.equal(p.$('toast').hidden, false);
    assert.match(text(p.$('toast')), /Saved recordings\/a\.jsonl · 2\.0 MB · 900 packets Replay: npm run replay -- recordings\/a\.jsonl/);
    p.close();
  });
});

describe('track map', () => {
  test('learns the circuit from every car and draws rivals with labels', async () => {
    const p = await boot();
    const map = p.$('map');
    Object.defineProperty(map, 'clientWidth', {value: 400});
    Object.defineProperty(map, 'clientHeight', {value: 300});
    p.push(dashboardState());
    p.drawLog.length = 0;
    p.eval('drawMap()');
    const labels = p.drawLog.filter(c => c[0] === 'fillText').map(c => c[1]);
    assert.ok(labels.includes('VER') && labels.includes('NOR'), labels.join(','));
    assert.ok(!labels.includes('YOU'), 'your car is the white dot, not a label');
    p.push(dashboardState({session: {...dashboardState().session, sessionUID: 'next'}, rivals: []}));
    assert.equal(p.eval('track.size'), 0, 'a new session forgets the old track');
    p.drawLog.length = 0;
    p.eval('car = null; drawMap()');
    assert.ok(p.drawLog.some(c => c[0] === 'fillText' && c[1] === 'WAITING FOR CARS ON TRACK'));
    p.close();
  });
});

describe('F1 26 (UDP format 2026)', () => {
  const t2 = o => ({
    m_activeAeroMode: 0, m_activeAeroAvailable: 1, m_activeAeroActivationDistance: 0, m_overtakeAvailable: 0,
    m_overtakeActive: 0, m_overtakeActivationDistance: 0, m_2026Regulations: 1, m_drivingWrongWay: 0, ...o,
  });
  test('overtake mode replaces DRS, with active aero mode', async () => {
    const p = await boot();
    p.push(dashboardState({telemetry2: t2({m_overtakeActive: 1, m_activeAeroMode: 1})}));
    assert.equal(p.$('drs').textContent, 'OVERTAKE');
    assert.equal(p.$('drs').classList.contains('on'), true);
    assert.equal(p.$('aero').hidden, false);
    assert.equal(p.$('aero').textContent, 'STRAIGHT');
    assert.equal(p.$('aero').classList.contains('on'), true);
    p.push(dashboardState({telemetry2: t2({m_overtakeAvailable: 1})}));
    assert.equal(p.$('drs').classList.contains('avail'), true, 'available but not active');
    assert.equal(p.$('aero').textContent, 'CORNER');
    p.push(dashboardState({telemetry2: t2({m_activeAeroAvailable: 0})}));
    assert.equal(p.$('aero').hidden, true);
    p.push(dashboardState({telemetry2: null}));
    assert.equal(p.$('aero').hidden, true);
    p.close();
  });
  test('wrong-way warning, reaction time, format chip and ERS boost', async () => {
    const p = await boot();
    const s = dashboardState({telemetry2: t2({m_drivingWrongWay: 1})});
    p.push({...s, status: {...s.status, m_ersDeployMode: 3}});
    assert.equal(p.$('wrongWay').hidden, false);
    assert.equal(p.$('reaction').textContent, 'REACTION 0.214s');
    assert.equal(p.$('fmtChip').hidden, false);
    assert.equal(p.$('ersMode').textContent, 'Boost · 8.5 MJ/lap');
    p.push(dashboardState({session: {...s.session, packetFormat: 2025, reactionTime: 0, aeroZones: [], drsZones: []}}));
    assert.equal(p.$('fmtChip').hidden, true);
    assert.equal(p.$('reaction').hidden, true);
    assert.equal(p.$('mapLegend').hidden, true);
    p.close();
  });
  test('standings tag cars using overtake mode or driving the wrong way', async () => {
    const p = await boot();
    const s = dashboardState();
    s.rivals[8].wrongWay = 1;
    p.push(s);
    const rows = p.doc.querySelectorAll('.srow');
    assert.match(rows[4].querySelector('.n').innerHTML, /tag ot/);
    assert.match(rows[8].querySelector('.n').textContent, /WRONG WAY/);
    p.close();
  });
  test('the rival popup and compare columns show the same badges', async () => {
    const p = await boot();
    const s = dashboardState();
    p.push(s);
    p.pointer(p.doc.querySelectorAll('.srow')[1], 'pointerdown');
    p.push({...s, detail: {...detailFor(s, 1), telemetry2: t2({m_overtakeActive: 1, m_activeAeroMode: 1})}});
    assert.equal(p.$('dmDrs').textContent, 'OVERTAKE');
    assert.equal(p.$('dmAero').textContent, 'STRAIGHT');
    p.key(p.doc, 'Escape');
    p.$('compareBtn').click();
    p.push({...s, compare: [{...detailFor(s, 2), telemetry2: t2({m_overtakeAvailable: 1})}, {...detailFor(s, 1), telemetry2: null}]});
    const [you, nor] = [...p.doc.querySelectorAll('.cc')];
    assert.equal(you.querySelector('.ccdrs').textContent, 'OVERTAKE');
    assert.equal(you.querySelector('.ccdrs').classList.contains('avail'), true);
    assert.equal(nor.querySelector('.ccdrs').textContent, 'DRS');
    p.close();
  });
  test('track map draws active aero and DRS zones', async () => {
    const p = await boot();
    const map = p.$('map');
    Object.defineProperty(map, 'clientWidth', {value: 400});
    Object.defineProperty(map, 'clientHeight', {value: 300});
    const s = dashboardState();
    p.push(s);
    assert.equal(p.$('mapLegend').hidden, false);
    const colours = () => {
      p.drawLog.length = 0;
      p.eval('drawMap()');
      return p.drawLog.filter(c => c[0] === 'set' && c[1] === 'strokeStyle').map(c => c[2]);
    };
    let used = colours();
    assert.ok(used.includes('rgba(51, 214, 232, .9)'), 'active aero zones drawn');
    assert.ok(used.includes('rgba(31, 209, 102, .9)'), 'DRS zones drawn');
    p.push(dashboardState({session: {...s.session, aeroZones: [], drsZones: []}}));
    used = colours();
    assert.ok(!used.includes('rgba(51, 214, 232, .9)') && !used.includes('rgba(31, 209, 102, .9)'));
    p.close();
  });
});

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
    assert.match(p.$('ersMode').textContent, /^(Hotlap|Boost) · 8\.5 MJ\/lap$/, 'mode plus the 2026 harvest limit');
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
  test('2026 cars show a battery instead of DRS; it glows only while overtake is in use', async () => {
    const p = await boot();
    const base = dashboardState();
    const status = (mode, store = 2000000) => ({...base.status, m_ersDeployMode: mode, m_ersStoreEnergy: store});
    const bat = p.$('bat');
    p.push({...base, status: status(3), telemetry2: t2({m_overtakeAvailable: 1, m_overtakeActive: 1, m_activeAeroMode: 1})});
    assert.equal(p.$('drs').hidden, true, 'no overtake badge');
    assert.equal(bat.hidden, false);
    assert.equal(bat.querySelector('.batpct').textContent, '50');
    assert.equal(bat.querySelector('.batfill').style.width, '50%');
    assert.equal(bat.classList.contains('boost'), true);
    assert.match(bat.title, /overtake mode in use/);
    assert.equal(bat.querySelector('.batlbl').textContent, 'BOOST', 'ERS mode named under the battery');
    assert.equal(p.$('aero').textContent, 'STRAIGHT');
    assert.equal(p.$('aero').classList.contains('on'), true);
    // regression: the game sets available = active all race; without Boost the battery stays calm
    p.push({...base, status: status(1), telemetry2: t2({m_overtakeAvailable: 1, m_overtakeActive: 1})});
    assert.equal(bat.classList.contains('boost'), false);
    assert.equal(bat.querySelector('.batlbl').textContent, 'MEDIUM');
    assert.match(bat.title, /ERS mode: MEDIUM/);
    assert.equal(p.$('aero').textContent, 'CORNER');
    assert.equal(p.$('aero').classList.contains('on'), false);
    p.push({...base, status: status(3), telemetry2: t2({m_overtakeAvailable: 1, m_overtakeActive: 1, m_overtakeActivationDistance: 150})});
    assert.equal(bat.classList.contains('boost'), false, 'countdown running');
    assert.match(bat.title, /available in 150 m/);
    p.push({...base, status: status(1, 300000), telemetry2: t2({})});
    assert.equal(bat.classList.contains('low'), true, 'under 15% turns red');
    p.push({...base, status: status(1, 9e9), telemetry2: t2({})});
    assert.equal(bat.querySelector('.batfill').style.width, '100%', 'clamped');
    // aero does not need m_activeAeroAvailable
    p.push({...base, telemetry2: t2({m_activeAeroAvailable: 0, m_activeAeroMode: 1})});
    assert.equal(p.$('aero').textContent, 'STRAIGHT');
    p.push({...base, telemetry2: t2({m_2026Regulations: 0})});
    assert.equal(p.$('aero').hidden, true);
    assert.equal(p.$('drs').hidden, false, 'pre-2026 cars keep DRS');
    assert.equal(p.$('drs').textContent, 'DRS');
    assert.equal(bat.hidden, false, 'battery still shown');
    p.push(dashboardState({telemetry2: null, status: null}));
    assert.equal(bat.hidden, true, 'no status, no battery');
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
  test('the rival popup and compare columns show the same battery', async () => {
    const p = await boot();
    const s = dashboardState();
    const boosting = d => ({...d, status: {...d.status, m_ersDeployMode: 3, m_ersStoreEnergy: 1000000}});
    p.push(s);
    p.pointer(p.doc.querySelectorAll('.srow')[1], 'pointerdown');
    p.push({...s, detail: boosting({...detailFor(s, 1), telemetry2: t2({m_overtakeActive: 1, m_activeAeroMode: 1})})});
    assert.equal(p.$('dmDrs').hidden, true);
    assert.equal(p.$('dmBat').classList.contains('boost'), true);
    assert.equal(p.$('dmBat').querySelector('.batpct').textContent, '25');
    assert.equal(p.$('dmAero').textContent, 'STRAIGHT');
    p.key(p.doc, 'Escape');
    p.$('compareBtn').click();
    p.push({...s, compare: [boosting({...detailFor(s, 2), telemetry2: t2({m_overtakeActive: 1})}), {...detailFor(s, 1), telemetry2: null}]});
    const [you, nor] = [...p.doc.querySelectorAll('.cc')];
    assert.equal(you.querySelector('.ccbat').classList.contains('boost'), true);
    assert.equal(you.querySelector('.ccdrs').hidden, true);
    assert.equal(nor.querySelector('.ccbat').classList.contains('boost'), false);
    assert.equal(nor.querySelector('.ccdrs').hidden, false);
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

describe('replay mode', () => {
  const replay = o => ({file: 'race.jsonl', playing: true, finished: false, speed: 1, loop: false, pos: 65000, duration: 600000, packets: 9000, ...o});
  const sentReplay = p => p.socket().sent.filter(m => m.replay).map(m => m.replay);

  test('live and demo show no replay UI', async () => {
    const p = await boot();
    p.push(dashboardState());
    assert.equal(p.$('replayChip').hidden, true);
    assert.equal(p.$('rp').hidden, true);
    assert.equal(p.doc.body.classList.contains('replaying'), false);
    assert.equal(p.$('connText').textContent, 'LIVE');
  });

  test('header badge makes the replay obvious, with speed and position', async () => {
    const p = await boot();
    p.push(dashboardState({replay: replay({speed: 2})}));
    assert.equal(p.$('replayChip').hidden, false);
    assert.match(p.$('replayChip').textContent, /REPLAY/);
    assert.equal(p.$('replayInfo').textContent, '2× · 1:05 / 10:00');
    assert.equal(p.doc.body.classList.contains('replaying'), true);
    assert.equal(p.$('connText').textContent, 'REPLAY');
    p.push(dashboardState({replay: replay({playing: false})}));
    assert.equal(p.$('replayInfo').textContent, 'PAUSED · 1:05 / 10:00');
    assert.equal(p.$('replayChip').classList.contains('paused'), true);
    p.push(dashboardState({replay: replay({playing: false, finished: true, pos: 600000})}));
    assert.equal(p.$('replayInfo').textContent, 'ENDED · 10:00 / 10:00');
    assert.equal(p.$('connText').textContent, 'REPLAY ENDED');
    p.push(dashboardState());
    assert.equal(p.$('replayChip').hidden, true, 'badge goes away when not replaying');
  });

  test('the waiting screen never covers a replay', async () => {
    const p = await boot();
    p.push(dashboardState({hasData: false, setup: {ips: [], udpPort: 20777}, replay: replay()}));
    assert.equal(p.$('wait').hidden, true);
  });

  test('floating popup shows the file, position, play state, loop and speed', async () => {
    const p = await boot();
    p.push(dashboardState({replay: replay({speed: 3, loop: true})}));
    assert.equal(p.$('rp').hidden, false);
    assert.equal(p.$('rpFile').textContent, 'race.jsonl');
    assert.equal(p.$('rpPos').textContent, '1:05');
    assert.equal(p.$('rpDur').textContent, '10:00');
    assert.equal(p.$('rpSeek').value, '108');
    assert.equal(p.$('rpPlay').textContent, '⏸');
    assert.equal(p.$('rpLoop').classList.contains('on'), true);
    const on = [...p.doc.querySelectorAll('#rpSpeeds button.on')].map(b => b.textContent);
    assert.deepEqual(on, ['3×']);
    assert.equal(p.doc.querySelectorAll('#rpSpeeds button').length, 7);
    p.push(dashboardState({replay: replay({playing: false, duration: 0, pos: 0})}));
    assert.equal(p.$('rpPlay').textContent, '▶');
    assert.equal(p.$('rpSeek').value, '0', 'empty recording does not divide by zero');
  });

  test('buttons send player commands', async () => {
    const p = await boot();
    p.push(dashboardState({replay: replay()}));
    p.$('rpPlay').click();
    p.$('rpRestart').click();
    p.$('rpBack').click();
    p.$('rpFwd').click();
    p.$('rpLoop').click();
    p.doc.querySelector('#rpSpeeds [data-speed="5"]').click();
    p.doc.querySelector('#rpSpeeds').click(); // between buttons: nothing
    assert.deepEqual(sentReplay(p), [
      {action: 'toggle'}, {action: 'restart'}, {action: 'skip', value: -10000}, {action: 'skip', value: 10000},
      {action: 'loop', value: true}, {action: 'speed', value: 5},
    ]);
    p.push(dashboardState({replay: replay({loop: true})}));
    p.$('rpLoop').click();
    assert.deepEqual(sentReplay(p).at(-1), {action: 'loop', value: false}, 'toggles loop off');
  });

  test('scrubbing seeks on release and does not fight the live position', async () => {
    const p = await boot();
    p.push(dashboardState({replay: replay()}));
    const seek = p.$('rpSeek');
    seek.value = '500';
    seek.dispatchEvent(new p.w.Event('input'));
    assert.equal(p.$('rpPos').textContent, '5:00', 'time follows the thumb');
    p.push(dashboardState({replay: replay({pos: 70000})}));
    assert.equal(seek.value, '500', 'server updates are held while scrubbing');
    seek.dispatchEvent(new p.w.Event('change'));
    assert.deepEqual(sentReplay(p), [{action: 'seek', value: 300000}]);
    p.push(dashboardState({replay: replay({pos: 300000})}));
    assert.equal(seek.value, '500');
    p.push(dashboardState({replay: replay({pos: 150000})}));
    assert.equal(seek.value, '250', 'following the server again');
  });

  test('controls do nothing without a connection or replay state', async () => {
    const p = await boot();
    p.socket().readyState = 3;
    p.$('rpPlay').click();
    assert.deepEqual(sentReplay(p), []);
    const seek = p.$('rpSeek');
    seek.dispatchEvent(new p.w.Event('input'));
    seek.dispatchEvent(new p.w.Event('change'));
    assert.deepEqual(sentReplay(p), []);
  });

  test('collapse button hides the controls, and dragging moves and remembers the popup', async () => {
    const p = await boot();
    p.push(dashboardState({replay: replay()}));
    p.$('rpMin').click();
    assert.equal(p.$('rp').classList.contains('collapsed'), true);
    p.$('rpMin').click();
    assert.equal(p.$('rp').classList.contains('collapsed'), false);
    const box = p.$('rp');
    box.getBoundingClientRect = () => ({left: 600, top: 500, width: 340, height: 200});
    Object.defineProperty(box, 'offsetWidth', {value: 340});
    Object.defineProperty(box, 'offsetHeight', {value: 200});
    const head = p.$('rpHead');
    const fire = (type, x, y, target = head) => target.dispatchEvent(new p.w.MouseEvent(type, {clientX: x, clientY: y, bubbles: true}));
    fire('pointerdown', 700, 510, p.$('rpMin')); // on a button: no drag
    assert.equal(box.classList.contains('placed'), false);
    fire('pointerdown', 700, 510);
    fire('pointermove', 600, 410);
    assert.equal(box.style.left, '500px');
    assert.equal(box.style.top, '400px');
    fire('pointermove', -5000, 9000);
    assert.equal(box.style.left, '6px', 'kept on screen');
    assert.equal(box.style.top, `${900 - 200 - 6}px`);
    fire('pointerup', 0, 0);
    assert.deepEqual(JSON.parse(p.w.localStorage.getItem('pitwall-replay-pos')), {x: 6, y: 694});
    const q = await boot({storage: {'pitwall-replay-pos': '{"x":120,"y":80}'}});
    assert.equal(q.$('rp').style.left, '120px', 'position restored');
    const bad = await boot({storage: {'pitwall-replay-pos': 'nope'}});
    assert.equal(bad.$('rp').classList.contains('placed'), false);
  });
});

describe('lap type tags', () => {
  test('standings tag flying, in and out laps', async () => {
    const p = await boot();
    const s = dashboardState();
    s.rivals.forEach(r => { r.driverStatus = 4; r.overtake = 0; r.pit = 0; r.penalty = 0; r.wrongWay = 0; });
    s.rivals[0].driverStatus = 1;
    s.rivals[1].driverStatus = 3;
    s.rivals[3].driverStatus = 2;
    s.rivals[5].driverStatus = 0;
    p.push(s);
    const tags = i => [...p.doc.querySelectorAll('.srow')[i].querySelectorAll('.tag')].map(t => t.textContent);
    assert.deepEqual(tags(0), ['FLY']);
    assert.deepEqual(tags(1), ['OUT']);
    assert.deepEqual(tags(3), ['IN']);
    assert.deepEqual(tags(5), [], 'garage: no tag');
    assert.deepEqual(tags(6), [], 'plain on track: no tag');
    assert.equal(p.doc.querySelectorAll('.srow')[0].querySelector('.tag.fly').title, 'Flying lap');
    s.rivals[1].pit = 1;
    p.push(s);
    assert.deepEqual(tags(1), ['PIT', 'OUT'], 'pit tag first');
    p.close();
  });
});

describe('hidden elements', () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'style.css'), 'utf8');
  test('the hidden attribute always wins over display set in CSS', () => {
    assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  });
  test('replay UI starts hidden and stays hidden outside replay mode', async () => {
    const p = await boot();
    assert.equal(p.$('replayChip').hidden, true, 'hidden before any data');
    assert.equal(p.$('rp').hidden, true);
    p.push(dashboardState());
    assert.equal(p.$('replayChip').hidden, true, 'hidden in demo / live');
    assert.equal(p.$('rp').hidden, true);
  });
});

describe('saved replays list', () => {
  const recs = [
    {file: 'session-b.jsonl', bytes: 126515802, modified: 1761260000000, startedAt: '2026-10-23T22:55:57.180Z', duration: 539463},
    {file: 'session-a.jsonl', bytes: 1048576, modified: 1761250000000, startedAt: null, duration: null},
  ];
  // fetch and window.open stubs; `tab` records what the new tab was told to do
  function stubs(p, {list = recs, openResult = {port: 4567, file: 'session-b.jsonl'}, openStatus = 200, blocked = false} = {}) {
    const calls = [];
    const tab = {written: '', href: '', closed: false, document: {write(h) { tab.written += h; }}, location: {set href(v) { tab.href = v; }}, close() { tab.closed = true; }};
    const opened = [];
    p.w.open = (...a) => { opened.push(a); return blocked ? null : tab; };
    p.w.fetch = async (url, opts) => {
      calls.push([url, opts]);
      if (opts && opts.method === 'POST') return {ok: openStatus === 200, status: openStatus, json: async () => openResult};
      if (list === null) return {ok: false, status: 500, json: async () => ({})};
      return {ok: true, status: 200, json: async () => list};
    };
    return {calls, tab, opened};
  }
  const settle = p => p.tick(5);

  test('the button opens a list of recordings, newest first, with length and size', async () => {
    const p = await boot();
    stubs(p);
    assert.equal(p.$('rl').hidden, true);
    p.$('replaysBtn').click();
    assert.equal(p.$('rl').hidden, false);
    await settle(p);
    const rows = [...p.doc.querySelectorAll('.rlrow')];
    assert.equal(rows.length, 2);
    assert.match(rows[0].textContent, /8:59/);
    assert.match(rows[0].textContent, /120\.7 MB/);
    assert.match(rows[0].textContent, /session-b\.jsonl/);
    assert.match(rows[1].textContent, /–/, 'unknown length');
    assert.match(p.$('rlNote').textContent, /Opens in a new tab/);
  });

  test('empty and failing lists say so', async () => {
    const p = await boot();
    stubs(p, {list: []});
    p.$('replaysBtn').click();
    await settle(p);
    assert.equal(p.doc.querySelectorAll('.rlrow').length, 0);
    assert.match(p.$('rlNote').textContent, /No recordings yet/);
    stubs(p, {list: null});
    p.$('replaysBtn').click();
    await settle(p);
    assert.match(p.$('rlNote').textContent, /Could not load/);
  });

  test('choosing a recording opens a new tab and points it at the replay', async () => {
    const p = await boot();
    const s = stubs(p);
    p.$('replaysBtn').click();
    await settle(p);
    p.doc.querySelector('.rlrow').click();
    assert.equal(s.opened.length, 1, 'tab opened inside the click');
    assert.match(s.tab.written, /Loading replay/);
    await settle(p);
    const post = s.calls.find(c => c[1] && c[1].method === 'POST');
    assert.equal(post[0], '/api/replays');
    assert.deepEqual(JSON.parse(post[1].body), {file: 'session-b.jsonl'});
    assert.equal(s.tab.href, 'http://localhost:4567/');
    assert.equal(p.$('rl').hidden, true, 'list closes');
    assert.equal(s.tab.closed, false);
  });

  test('a failed open closes the blank tab and explains', async () => {
    const p = await boot();
    const s = stubs(p, {openStatus: 404, openResult: {error: 'No such recording'}});
    p.$('replaysBtn').click();
    await settle(p);
    p.doc.querySelector('.rlrow').click();
    await settle(p);
    assert.equal(s.tab.closed, true);
    assert.equal(p.$('rl').hidden, false, 'list stays open to pick another');
    assert.match(p.$('rlNote').textContent, /Could not open the replay: No such recording/);
  });

  test('a blocked popup falls back to a link', async () => {
    const p = await boot();
    const s = stubs(p, {blocked: true});
    p.$('replaysBtn').click();
    await settle(p);
    p.doc.querySelector('.rlrow').click();
    await settle(p);
    assert.equal(s.opened.length, 2, 'tried again once the address was known');
    assert.equal(s.opened[1][0], 'http://localhost:4567/');
  });

  test('closing: the x, the backdrop and Escape; clicking inside the box keeps it open', async () => {
    const p = await boot();
    stubs(p);
    const open = async () => { p.$('replaysBtn').click(); await settle(p); };
    await open();
    p.$('rlClose').click();
    assert.equal(p.$('rl').hidden, true);
    await open();
    p.doc.querySelector('.rlbox').click();
    assert.equal(p.$('rl').hidden, false);
    p.$('rl').click();
    assert.equal(p.$('rl').hidden, true);
    await open();
    p.key(p.doc, 'Escape');
    assert.equal(p.$('rl').hidden, true);
    p.key(p.doc, 'Escape'); // already closed: harmless
  });

  test('the button is there on the live dashboard but not inside a replay', async () => {
    const p = await boot();
    p.push(dashboardState());
    assert.equal(p.$('replaysBtn').hidden, false);
    p.push(dashboardState({replay: {file: 'x.jsonl', playing: true, finished: false, speed: 1, loop: false, pos: 0, duration: 1000, packets: 5}}));
    assert.equal(p.$('replaysBtn').hidden, true);
    p.push(dashboardState());
    assert.equal(p.$('replaysBtn').hidden, false);
  });
});

describe('stylesheet class clashes', () => {
  test('the replay list overlay does not reuse the tyre callout class "rl" (rear left)', () => {
    const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'style.css'), 'utf8');
    assert.doesNotMatch(css, /^\.rl\s*\{/m, 'a bare .rl rule would hit the rear-left tyre callout');
    return boot().then(p => {
      assert.equal(p.$('rl').classList.contains('rl'), false);
      assert.ok(p.doc.querySelector('.ti.rl'), 'tyre callout still uses .rl');
    });
  });
});

describe('replays from the waiting screen', () => {
  test('the waiting screen offers saved replays without live data', async () => {
    const p = await boot();
    const calls = [];
    p.w.fetch = async url => { calls.push(url); return {ok: true, status: 200, json: async () => [{file: 'a.jsonl', bytes: 1048576, modified: 1, startedAt: null, duration: 5000}]}; };
    p.push(dashboardState({hasData: false, setup: {ips: [], udpPort: 20777}}));
    assert.equal(p.$('wait').hidden, false);
    p.$('waitReplays').click();
    await p.tick(5);
    assert.deepEqual(calls, ['/api/replays']);
    assert.equal(p.$('rl').hidden, false);
    assert.equal(p.doc.querySelectorAll('.rlrow').length, 1);
  });
});

describe('battery colour', () => {
  const t2 = o => ({m_activeAeroMode: 0, m_activeAeroAvailable: 0, m_activeAeroActivationDistance: 0, m_overtakeAvailable: 1,
    m_overtakeActive: 1, m_overtakeActivationDistance: 0, m_2026Regulations: 1, m_drivingWrongWay: 0, ...o});
  const colour = b => (b.classList.contains('ot') ? 'blue' : b.classList.contains('low') ? 'red' : 'green');
  test('blue with overtake mode, otherwise green with charge and red when empty', async () => {
    const p = await boot();
    const base = dashboardState();
    const push = (type, mode, store, over) => p.push({...base, session: {...base.session, sessionType: type},
      status: {...base.status, m_ersDeployMode: mode, m_ersStoreEnergy: store}, telemetry2: t2(over)});
    const bat = p.$('bat');
    push(15, 1, 2000000);
    assert.equal(colour(bat), 'blue', 'race, overtake available');
    assert.match(bat.title, /overtake mode available/);
    push(15, 1, 100000);
    assert.equal(colour(bat), 'blue', 'having overtake wins over a low charge');
    push(15, 3, 2000000);
    assert.equal(colour(bat), 'blue', 'in use');
    assert.equal(bat.classList.contains('boost'), true);
    push(15, 1, 2000000, {m_overtakeActivationDistance: 120});
    assert.equal(colour(bat), 'green', 'countdown running: no overtake, has charge');
    push(15, 1, 100000, {m_overtakeAvailable: 0, m_overtakeActive: 0});
    assert.equal(colour(bat), 'red', 'no overtake, nearly empty');
    push(5, 1, 2000000);
    assert.equal(colour(bat), 'green', 'qualifying: the always-on flag is ignored');
    push(5, 3, 2000000);
    assert.equal(colour(bat), 'blue', 'but Boost in use still counts');
  });
});

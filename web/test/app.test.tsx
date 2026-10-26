// The dashboard page in jsdom, driven by server messages. Ported from the original page's test/ui.test.js:
// the same scenarios and expected values, against the React page.
import {act} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {useUi} from '../src/store/ui';
import {buffers} from '../src/telemetry/buffers';
import {boot, dashboardState, detailFor, packHistory, text, type Page} from './helpers';

const row = (p: Page, i: number) => p.$$('.srow')[i];

describe('connection', () => {
  test('announces no driver and no comparison when the socket opens', async () => {
    const p = await boot();
    expect(p.sent()).toEqual([{select: null}, {compare: []}]);
    expect(p.socket().url).toBe('ws://localhost:3000/ws');
  });
  test('status: live, paused, waiting, offline with reconnect', async () => {
    vi.useFakeTimers({toFake: ['setTimeout']});
    try {
      const p = await boot();
      p.push(dashboardState());
      expect(p.$('.conntext')!.textContent).toBe('LIVE');
      expect(p.$('.status .dot')!.className).toBe('dot live');
      p.push(dashboardState({connected: false}));
      expect(p.$('.conntext')!.textContent).toBe('NO SIGNAL — PAUSED?');
      expect(p.$('.status .dot')!.className).toBe('dot idle');
      p.push(dashboardState({connected: false, hasData: false}));
      expect(p.$('.conntext')!.textContent).toBe('WAITING FOR GAME');
      expect(p.$('.pps b')!.textContent).toBe('20');
      act(() => p.socket().close());
      expect(p.$('.conntext')!.textContent).toBe('SERVER OFFLINE — RETRYING');
      expect(p.$('.status .dot')!.className).toBe('dot');
      act(() => vi.advanceTimersByTime(1600));
      expect((await import('./helpers')).FakeWebSocket.sockets.length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('setup overlay', () => {
  const waiting = {hasData: false, setup: {ips: [{name: 'en0', address: '10.0.0.4'}], udpPort: 20777}};
  const pick = (p: Page, format: string) => p.$(`.fmtpick [data-format="${format}"]`)!;

  test('shows the IP and port to enter in the game until data arrives', async () => {
    const p = await boot({storage: {'pitwall-format': '2026'}});
    const ips = [{name: 'en0', address: '192.168.8.131'}, {name: 'en5', address: '10.0.0.4'}];
    p.push(dashboardState({hasData: false, setup: {ips, udpPort: 20799, demo: false}}));
    expect(p.$('.wait')).not.toBeNull();
    expect(p.$('.waitip')!.textContent).toBe('192.168.8.131');
    expect(p.$('.waitport')!.textContent).toBe('20799');
    expect(p.$('.waitalt')!.textContent).toBe('Other addresses: 10.0.0.4 (en5)');
    p.push(dashboardState({hasData: false, setup: {ips: [], udpPort: 20777}}));
    expect(p.$('.waitip')!.textContent).toBe('no network found');
    p.push(dashboardState({hasData: true, connected: false}));
    expect(p.$('.wait'), 'stays closed while paused').toBeNull();
  });
  test('asks which telemetry format to use before showing the game settings', async () => {
    const p = await boot();
    p.push(dashboardState(waiting));
    expect(p.$('.setup'), 'settings wait for a choice').toBeNull();
    expect(p.$('.fmtpick')!.classList.contains('need')).toBe(true);
    p.click(pick(p, '2026'));
    expect(p.$('.setup')).not.toBeNull();
    expect(p.$('.waitformat')!.textContent).toBe('2026 (F1 26)');
    expect(pick(p, '2026').classList.contains('on')).toBe(true);
    expect(pick(p, '2025').classList.contains('on')).toBe(false);
    expect(p.$('.fmtpick')!.classList.contains('need')).toBe(false);
    p.click(pick(p, '2025'));
    expect(p.$('.waitformat')!.textContent).toBe('2025 (F1 25)');
  });
  test('remembers the chosen format', async () => {
    const p = await boot();
    p.push(dashboardState(waiting));
    p.click(pick(p, '2025'));
    expect(localStorage.getItem('pitwall-format')).toBe('2025');
    const q = await boot({storage: {'pitwall-format': '2026'}});
    q.push(dashboardState(waiting));
    expect(q.$('.waitformat')!.textContent, 'no need to choose again').toBe('2026 (F1 26)');
    const bad = await boot({storage: {'pitwall-format': 'nope'}});
    bad.push(dashboardState(waiting));
    expect(bad.$('.setup'), 'an invalid stored value counts as no choice').toBeNull();
  });
  test('warns once when the game sends another format than the chosen one', async () => {
    const p = await boot({storage: {'pitwall-format': '2025'}});
    const s = dashboardState();
    p.push({...s, session: {...s.session!, packetFormat: 2025}});
    expect(p.$('.toast'), 'matching format: no warning').toBeNull();
    p.push(s); // demo frames are format 2026
    expect(p.$('.toast')!.textContent).toMatch(/sending UDP format 2026, not 2025/);
    act(() => useUi.setState({toast: null}));
    p.push(s);
    expect(p.$('.toast'), 'not repeated').toBeNull();
    const none = await boot();
    none.push(s);
    expect(none.$('.toast'), 'no choice made: nothing to compare').toBeNull();
  });
  test('the waiting screen offers saved replays without live data', async () => {
    const fetch = vi.fn(async () => ({ok: true, status: 200, json: async () => [{file: 'a.jsonl', bytes: 1048576, modified: 1, startedAt: null, duration: 5000}]}));
    vi.stubGlobal('fetch', fetch);
    const p = await boot();
    p.push(dashboardState({hasData: false, setup: {ips: [], udpPort: 20777}}));
    p.click('.waitreplay');
    await act(async () => {});
    expect(fetch).toHaveBeenCalledWith('/api/replays');
    expect(p.$$('.rlrow').length).toBe(1);
    vi.unstubAllGlobals();
  });
});

describe('session header and driving', () => {
  test('track, weather and temperatures', async () => {
    const p = await boot();
    p.push(dashboardState());
    expect(p.$('.chip.track')!.textContent).toBe('Demo Circuit');
    expect(p.$('.weather')!.textContent).toBe('Clear');
    expect(p.$('.tracktemp')!.textContent).toBe('34');
    expect(p.$('.airtemp')!.textContent).toBe('24');
  });
  test('header shows the session, lap and time left', async () => {
    const p = await boot();
    const s = dashboardState();
    p.push(s);
    expect(p.$('.chip.sess')!.textContent).toMatch(/^Race · LAP \d+\/30$/);
    p.push({...s, session: {...s.session!, sessionType: 6, timeLeft: 605}, lap: {...s.lap!, m_currentLapNum: 4}});
    expect(p.$('.chip.sess')!.textContent).toBe('Qualifying 2 · LAP 4 · 10:05 LEFT');
    p.push({...s, session: {...s.session!, sessionType: 0}});
    expect(p.$('.chip.sess')).toBeNull();
  });
  test('speed, gear, rpm, DRS, rev lights, pedals and steering', async () => {
    const p = await boot();
    const s = dashboardState();
    p.push(s);
    const d = (sel: string) => p.$(`.driving ${sel}`)!;
    expect(d('.speedv').textContent).toBe('310');
    expect(d('.gearv').textContent).toBe('8');
    expect(d('.rpmv').textContent).toBe(String(s.telemetry!.m_engineRPM));
    expect(p.$$('.rev i.on').length, '75% of 15 LEDs').toBe(11);
    expect(d('.thr').style.height).toBe('100%');
    expect(d('.brk').style.height).toBe('0%');
    p.push(dashboardState({telemetry: {...s.telemetry!, m_gear: 0, m_drs: 1}, telemetry2: null}));
    expect(d('.drs').classList.contains('on')).toBe(true);
    expect(d('.gearv').textContent).toBe('N');
    p.push(dashboardState({telemetry: {...s.telemetry!, m_gear: -1, m_drs: 0, m_steer: -1}, telemetry2: null}));
    expect(d('.gearv').textContent).toBe('R');
    expect(d('.drs').textContent, 'pre-2026 cars show DRS').toBe('DRS');
    expect(d('.drs').classList.contains('on')).toBe(false);
    expect(d('.steerv').style.left).toBe('5%');
    expect(buffers.pedals.length, 'pedal trace samples').toBe(3);
  });
});

describe('tyres and car', () => {
  test('wear per corner (game order RL RR FL FR), colours and tread drain', async () => {
    const p = await boot();
    p.push(dashboardState()); // wear [24, 28, 43, 66]
    const wear = (c: string) => p.$(`.tyres .ti.${c} .ti-wear b`)!.textContent;
    expect(['fl', 'fr', 'rl', 'rr'].map(wear)).toEqual(['43', '66', '24', '28']);
    expect(p.$('.tyres .ti.fr .ti-wear')!.style.color, '66% is red').toBe('rgb(255, 45, 31)');
    expect(p.$('.tyres .ti.rl .ti-wear')!.style.color, '24% is green').toBe('rgb(31, 209, 102)');
    const worn = p.$$('.tyres .worn');
    expect(Number(worn[1].getAttribute('height')).toFixed(2), 'FR tread drained 66%').toBe((42 * 0.66).toFixed(2));
    expect(p.$$('.tyres .ti.fl dd').map(d => d.textContent)).toEqual(['90°', '96°', '23.4', '380°']);
  });
  test('compound, fuel and ERS', async () => {
    const p = await boot();
    p.push(dashboardState());
    expect(p.$('.tyres .cname')!.textContent).toBe('Medium');
    expect(p.$('.tyres .cage')!.textContent).toBe('2 laps');
    expect(p.$('.tyres .fueltxt')!.textContent).toMatch(/^\d+\.\d KG$/);
    expect(p.$('.tyres .fuellaps')!.textContent).toBe('+0.80 laps');
    expect(p.$('.tyres .erstxt')!.textContent).toBe('50%');
    expect(p.$('.tyres .ersmode')!.textContent, 'mode plus the 2026 harvest limit').toMatch(/^(Hotlap|Boost) · 8\.5 MJ\/lap$/);
    expect(Math.abs(parseFloat(p.$('.tyres .ers')!.style.width) - 50)).toBeLessThan(1e-6);
  });
  test('damage tiles and highlighted car parts', async () => {
    const p = await boot();
    p.push(dashboardState());
    const tiles = p.$$('.tyres .dc').map(el => [el.querySelector('span')!.textContent, el.className, el.querySelector('b')!.firstChild!.textContent]);
    expect(tiles).toEqual([
      ['FL wing', 'dc l1', '12'], ['FR wing', 'dc l0', '0'], ['Rear wing', 'dc l0', '0'], ['Floor', 'dc l1', '4'],
      ['Diffuser', 'dc l0', '0'], ['Sidepods', 'dc l2', '27'], ['Gearbox', 'dc l0', '0'], ['Engine', 'dc l1', '3'],
    ]);
    expect(p.$<SVGElement>('.tyres .spl')!.style.fill).toMatch(/^rgba\(255, 122, 26, 0?\.85\)$/);
    expect(p.$<SVGElement>('.tyres .rw')!.style.fill).toBe('');
  });
});

describe('lap timing', () => {
  test('position, lap, times, sectors and best lap', async () => {
    const p = await boot();
    const s = dashboardState();
    p.push(s);
    const t = (sel: string) => p.$(`.lap ${sel}`)!.textContent;
    expect(t('.pos')).toBe('3');
    expect(t('.lapnum')).toBe('2');
    expect(t('.totallaps')).toBe('30');
    expect(t('.cur')).toBe('0:15.000');
    expect(t('.last')).toBe('0:29.880');
    expect(t('.best')).toBe('0:29.880');
    expect(text(p.$('.lap .s1'))).toBe('S1 9.800');
    expect(p.$('.lap .s2')!.classList.contains('active')).toBe(true);
    p.push(dashboardState({lap: {...s.lap!, m_lastLapTimeInMS: 31000}}));
    expect(t('.best'), 'slower lap keeps the best').toBe('0:29.880');
    p.push(dashboardState({lap: {...s.lap!, m_lastLapTimeInMS: 29000, m_sector: 2, m_sector2TimeInMS: 10000, m_currentLapTimeInMS: 25000}}));
    expect(t('.best')).toBe('0:29.000');
    expect(text(p.$('.lap .s3')), 'S3 = current lap - S1 - S2').toBe('S3 5.200');
    expect(p.$('.lapinvalid')).toBeNull();
    p.push(dashboardState({lap: {...s.lap!, m_currentLapInvalid: 1, m_pitStatus: 1}}));
    expect(p.$('.lapinvalid')).not.toBeNull();
    expect(p.$('.inpit')).not.toBeNull();
  });
});

describe('standings', () => {
  test('rows in position order with player, pit, penalty and retired markers', async () => {
    const p = await boot();
    const s = dashboardState();
    s.rivals![12].result = 4;
    p.push(s);
    const rows = p.$$('.srow');
    expect(rows.length).toBe(13);
    expect(rows[2].classList.contains('me')).toBe(true);
    expect(rows[0].querySelector('.g')!.textContent).toBe('LEADER');
    expect(rows[7].querySelector('.tag.pit')).not.toBeNull();
    expect(rows[5].querySelector('.n')!.textContent).toMatch(/HAMILTON\+5s/);
    expect(rows[12].classList.contains('out')).toBe(true);
    expect(rows[12].querySelector('.g')!.textContent).toBe('OUT');
    expect(rows[0].querySelector('.n')!.textContent).toBe('VERSTAPPEN');
    p.push(dashboardState({rivals: []}));
    expect(text(p.$('.rows'))).toBe('No rivals yet');
  });
  test('interval / leader gap toggle', async () => {
    const p = await boot();
    const s = dashboardState();
    p.push(s);
    const gap1 = () => row(p, 1).querySelector('.g')!.textContent;
    expect(gap1()).toBe('+' + (s.rivals![1].gapFront / 1000).toFixed(3));
    p.click('.gapmode');
    expect(p.$('.gapmode')!.textContent).toBe('LEADER');
    expect(gap1()).toBe('+' + (s.rivals![1].gapLeader / 1000).toFixed(3));
  });
  test('LAST / BEST toggle: delta to the fastest lap, remembered', async () => {
    const p = await boot();
    const s = dashboardState();
    p.push(s);
    p.click('.lapmode');
    expect(p.$('.lapmode')!.textContent).toBe('BEST');
    expect(p.$('.gaphead')!.textContent).toBe('Δ BEST');
    expect(p.$<HTMLButtonElement>('.gapmode')!.disabled).toBe(true);
    const fastest = Math.min(...s.rivals!.map(r => r.best));
    const rows = p.$$('.srow');
    const fastestRows = rows.filter(r => r.querySelector('.g')!.textContent === 'FASTEST');
    expect(fastestRows.length).toBeGreaterThanOrEqual(1);
    expect(fastestRows.every(r => r.querySelector('.l')!.classList.contains('fastest'))).toBe(true);
    const other = s.rivals!.findIndex(r => r.best !== fastest);
    expect(rows[other].querySelector('.g')!.textContent).toBe('+' + ((s.rivals![other].best - fastest) / 1000).toFixed(3));
    expect(localStorage.getItem('pitwall-lapmode')).toBe('best');
    const again = await boot({storage: {'pitwall-lapmode': 'best'}});
    expect(again.$('.lapmode')!.textContent).toBe('BEST');
  });
  test('restricted players show their race number', async () => {
    const p = await boot();
    const s = dashboardState();
    Object.assign(s.rivals![6], {name: 'Player', human: true, telemetryPublic: false, num: 24});
    p.push(s);
    expect(row(p, 6).querySelector('.n')!.textContent).toBe('Player#24');
  });
  test('tags flying and out laps, pit first', async () => {
    const p = await boot();
    const s = dashboardState();
    s.rivals!.forEach(r => Object.assign(r, {driverStatus: 4, overtake: 0, pit: 0, penalty: 0, wrongWay: 0}));
    s.rivals![0].driverStatus = 1;
    s.rivals![1].driverStatus = 3;
    s.rivals![3].driverStatus = 2;
    s.rivals![5].driverStatus = 0;
    p.push(s);
    const tags = (i: number) => [...row(p, i).querySelectorAll('.tag')].map(t => t.textContent);
    expect(tags(0)).toEqual(['FLY']);
    expect(tags(1)).toEqual(['OUT']);
    expect(tags(3), 'in lap: no tag').toEqual([]);
    expect(tags(5), 'garage: no tag').toEqual([]);
    expect(tags(6), 'plain on track: no tag').toEqual([]);
    expect(row(p, 0).querySelector<HTMLElement>('.tag.fly')!.title).toBe('Flying lap');
    s.rivals![1].pit = 1;
    p.push(s);
    expect(tags(1), 'pit tag first').toEqual(['PIT', 'OUT']);
  });
  test('only rows whose values changed re-render', async () => {
    const p = await boot();
    const s = dashboardState();
    p.push(s);
    const before = p.$$('.srow');
    p.push({...s, rivals: s.rivals!.map((r, i) => (i === 4 ? {...r, penalty: 10} : {...r}))});
    const after = p.$$('.srow');
    expect(after.every((el, i) => el === before[i]), 'rows are updated in place, not rebuilt').toBe(true);
    expect(after[4].querySelector('.tag.pen')!.textContent).toBe('+10s');
  });
});

describe('rival popup', () => {
  test('opens on a row, asks the server for that car, shows its data', async () => {
    const p = await boot();
    const s = dashboardState();
    p.push(s);
    p.click(row(p, 1));
    expect(p.$('.dm')).not.toBeNull();
    expect(p.sent().at(-1)).toEqual({select: 1});
    expect(p.$('.dmnote')!.textContent).toBe("Waiting for this car's data…");
    p.push({...s, detail: detailFor(s, 1)});
    expect(p.$('.dmname')!.textContent).toBe('NORRIS');
    expect(p.$('.dmteam')!.textContent).toBe('#11 · McLaren');
    expect(p.$('.dmpos b')!.textContent).toBe('2');
    expect(p.$('.dmbox .speedv')!.textContent).toBe('310');
    expect(p.$('.dmlapnum')!.textContent).toBe('2 / 30');
    expect(p.$('.dmnote')).toBeNull();
    expect(text(p.$('.dmbox .stratline'))).toMatch(/^Strategy \d+ laps to 70%/);
    expect(p.$$('.dmbox .ti').length).toBe(4);
    expect(p.$$('.dmbox .dc').length).toBe(8);
  });
  test('explains restricted telemetry', async () => {
    const p = await boot();
    const s = dashboardState();
    s.rivals![1].telemetryPublic = false;
    p.push(s);
    p.click(row(p, 1));
    p.push({...s, detail: {...detailFor(s, 1), telemetry: {...s.telemetry!, m_speed: 0, m_engineRPM: 0}}});
    expect(p.$('.dmnote')!.textContent).toMatch(/Restricted/);
  });
  test('Escape and ✕ close it and tell the server', async () => {
    const p = await boot();
    p.push(dashboardState());
    p.click(row(p, 3));
    p.key(document, 'Escape');
    expect(p.$('.dm')).toBeNull();
    expect(p.sent().at(-1)).toEqual({select: null});
    p.click(row(p, 3));
    p.click('.dmclose');
    expect(p.$('.dm')).toBeNull();
  });
  test('the trace starts from the server history, even after live samples', async () => {
    const p = await boot();
    const s = dashboardState();
    p.push(s);
    p.click(row(p, 1));
    p.push({...s, detail: detailFor(s, 1)});
    expect(buffers.rivalPedals.length, 'a live sample before the history arrived').toBe(1);
    const trail = [3000, 2000, 1000].map(a => ({a, speed: 1, thr: 0.5, brk: 0, gear: 3, ers: 0, mode: 0}));
    p.push({...s, detail: {...detailFor(s, 1), history: packHistory({trail, lt: null})}});
    const t = buffers.rivalPedals.map(x => x.t);
    expect(t.length, "history replaced what was there, plus this message's sample").toBe(4);
    expect([...t].sort((a, b) => a - b), 'in time order: the trace never zigzags').toEqual(t);
  });
});

describe('compare mode', () => {
  const cols = (p: Page) => p.$$('.cc');
  const chip = (p: Page, idx: number) => p.$<HTMLButtonElement>(`.pchip[data-idx="${idx}"]`)!;
  test('defaults to you and the car ahead, and subscribes', async () => {
    const p = await boot();
    p.push(dashboardState());
    p.click('.comparebtn');
    expect(p.$('.cmp')).not.toBeNull();
    expect(useUi.getState().compare).toEqual([2, 1]);
    expect(p.sent().at(-1)).toEqual({compare: [2, 1]});
    expect(cols(p).length).toBe(2);
    expect(p.$$('.pchip.on').length).toBe(2);
  });
  test('picker adds and removes drivers, up to four', async () => {
    const p = await boot();
    p.push(dashboardState());
    p.click('.comparebtn2');
    p.click(chip(p, 0));
    p.click(chip(p, 5));
    expect(useUi.getState().compare).toEqual([2, 1, 0, 5]);
    expect(chip(p, 7).disabled, 'fifth driver is blocked').toBe(true);
    p.click(chip(p, 0));
    expect(useUi.getState().compare).toEqual([2, 1, 5]);
    p.click(cols(p)[1].querySelector('.ccx')!);
    expect(useUi.getState().compare).toEqual([2, 5]);
    expect(p.sent().at(-1)).toEqual({compare: [2, 5]});
  });
  test('columns show each driver, the delta to the reference and the faster laps', async () => {
    const p = await boot();
    const s = dashboardState();
    p.push(s);
    p.click('.comparebtn');
    p.push({...s, compare: [detailFor(s, 2), detailFor(s, 1)]});
    const [you, nor] = cols(p);
    expect(you.querySelector('.ccname')!.textContent).toBe('YOU');
    expect(you.querySelector('.ccvsl')!.textContent).toBe('REFERENCE');
    expect(nor.querySelector('.ccname')!.textContent).toBe('NORRIS');
    expect(nor.querySelector('.ccvsl')!.textContent).toBe('VS YOU');
    const delta = s.rivals![1].gapLeader - s.rivals![2].gapLeader;
    expect(nor.querySelector('.ccvs')!.textContent).toBe('−' + Math.abs(delta / 1000).toFixed(3));
    expect(nor.querySelector('.ccvs')!.classList.contains('ahead')).toBe(true);
    expect(nor.querySelector('.cclast')!.classList.contains('purple'), 'NORRIS has the faster last lap').toBe(true);
    expect(you.querySelector('.ccspd')!.textContent).toBe('310');
    expect(you.querySelector('.ccthrv')!.textContent).toBe('100%');
    expect(you.querySelectorAll('.ti').length, 'same car diagram as the dashboard').toBe(4);
    expect(you.querySelectorAll('.dc').length).toBe(8);
    expect(text(you.querySelector('.ccstrat'))).toMatch(/^Strategy/);
  });
  test('charts opened late start from the server history instead of empty', async () => {
    const p = await boot();
    const s = dashboardState();
    p.push(s);
    p.click('.comparebtn');
    const sample = (a: number, speed: number) => ({a, speed, thr: 1, brk: 0, gear: 4, ers: 0.5, mode: 2});
    const pt = (d: number, speed: number) => ({d, ...sample(0, speed)});
    const lt = {lap: 3, cur: [pt(0, 100)], last: [], lastLap: null, best: [pt(0, 90), pt(50, 95)], bestLap: 2, bestTime: 90000};
    p.push({...s, compare: [{...detailFor(s, 2), history: packHistory({trail: [sample(8000, 200), sample(4000, 250)], lt})}, detailFor(s, 1)]});
    expect(buffers.trails.get(2)!.length, 'two history samples plus the live one').toBe(3);
    expect(buffers.laps.get(2)!.best.map(x => [x.d, x.speed])).toEqual([[0, 90], [50, 95]]);
    // a best lap that is also the last lap arrives once, and is the same trace on the page
    const same = {...lt, last: lt.best, best: 'last' as const};
    p.push({...s, compare: [{...detailFor(s, 2), history: packHistory({trail: [], lt: same})}, detailFor(s, 1)]});
    expect(buffers.laps.get(2)!.best).toBe(buffers.laps.get(2)!.last);
    expect(buffers.laps.get(2)!.best.length).toBe(2);
  });
  test('the live trace window: 20 s, 1 min or 3 min, remembered', async () => {
    const p = await boot();
    const s = dashboardState();
    p.push(s);
    p.click('.comparebtn');
    expect(p.$('.cmpchartlbl')!.textContent).toBe('Live trace · last 20 s');
    const trail = Array.from({length: 180}, (_, i) => ({a: (179 - i) * 1000, speed: 200, thr: 1, brk: 0, gear: 6, ers: 0.5, mode: 2}));
    p.push({...s, compare: [{...detailFor(s, 2), history: packHistory({trail, lt: null})}]});
    expect(buffers.trails.get(2)!.length, 'all 3 minutes kept, plus the live sample').toBe(181);
    p.click('.cmpwin [data-w="180"]');
    expect(p.$('.cmpchartlbl')!.textContent).toBe('Live trace · last 3 min');
    expect(localStorage.getItem('pitwall-cmpwin')).toBe('180');
    p.click('.cmpaxis [data-a="dist"]');
    expect(p.$('.cmpwin'), 'no time window on the distance axis').toBeNull();
    const again = await boot({storage: {'pitwall-cmpwin': '60'}});
    again.push(dashboardState());
    again.click('.comparebtn');
    expect(again.$('.cmpchartlbl')!.textContent).toBe('Live trace · last 1 min');
    expect(again.$<HTMLElement>('.cmpwin .on')!.dataset.w).toBe('60');
    await boot({storage: {'pitwall-cmpwin': '999'}});
    expect(useUi.getState().window, 'an unknown stored value falls back to 20 s').toBe(20);
  });
  test('chart toggles and lap-synced traces', async () => {
    const p = await boot();
    const s = dashboardState();
    p.push(s);
    p.click('.comparebtn');
    p.click('.cmpaxis [data-a="dist"]');
    expect(p.$('.cmplap')).not.toBeNull();
    expect(p.$('.cmpchartlbl')!.textContent).toBe('Lap-synced trace · by distance');
    p.click('.cmplap [data-l="last"]');
    expect(useUi.getState().lapView).toBe('last');
    p.click('.cmpmetric [data-m="thr"]');
    expect(useUi.getState().metric).toBe('thr');
    expect(p.$<HTMLElement>('.cmpmetric .on')!.dataset.m).toBe('thr');
    p.push({...s, compare: [detailFor(s, 2)]});
    expect(buffers.laps.get(2)!.cur.length).toBe(1);
    expect(buffers.trails.get(2)!.length).toBe(1);
    p.click('.cmpaxis [data-a="time"]');
    expect(p.$('.cmplap')).toBeNull();
  });
  test('opening from the popup adds that driver; Escape closes and unsubscribes', async () => {
    const p = await boot();
    p.push(dashboardState());
    p.click(row(p, 6));
    p.click('.dmbox .hbtn.accent');
    expect(p.$('.dm')).toBeNull();
    expect(useUi.getState().compare).toEqual([2, 6]);
    p.key(document, 'Escape');
    expect(p.$('.cmp')).toBeNull();
    expect(p.sent().at(-1)).toEqual({compare: []});
  });
});

describe('strategy panel', () => {
  test('tyre projection, pit, pace and battles for your car', async () => {
    const p = await boot();
    p.push(dashboardState());
    const t = text(p.$('.strat'));
    expect(t).toMatch(/17 laps until FR hits 70% box ≈ L19/);
    expect(t).toMatch(/FL 19 2\.70%\/lap/);
    expect(t).toMatch(/Game pit window L14 – L19/);
    expect(t).toMatch(/Game rejoin estimate P7/);
    expect(t).toMatch(/Pit loss · measured 21\.4s 3 stops/);
    expect(t).toMatch(/Pit now → P13 behind HULKENBERG 8\.40s/);
    expect(t).toMatch(/Fuel margin \+0\.80 laps/);
    expect(t).toMatch(/1:30\.360 avg \+0\.11s per lap slower/);
    expect(t).toMatch(/AHEAD NORRIS \+0\.98s catching 0\.06s\/lap · in DRS range/);
    expect(t).toMatch(/BEHIND LECLERC −[\d.]+s dropping back 0\.24s\/lap/);
    expect(p.$$('.sbars i').length).toBe(5);
  });
  test('the PIT AT limit changes the projection and is remembered', async () => {
    const p = await boot();
    p.push(dashboardState());
    const select = p.$<HTMLSelectElement>('.wearlimit select')!;
    act(() => {
      select.value = '60';
      select.dispatchEvent(new Event('change', {bubbles: true}));
    });
    expect(text(p.$('.strat'))).toMatch(/13 laps until FR hits 60% box ≈ L15/);
    expect(localStorage.getItem('pitwall-wearlimit')).toBe('60');
    const again = await boot({storage: {'pitwall-wearlimit': '80'}});
    expect(again.$<HTMLSelectElement>('.wearlimit select')!.value).toBe('80');
  });
  test('says what it is waiting for', async () => {
    const p = await boot();
    const s = dashboardState({pitLoss: null, status: null});
    Object.assign(s.rivals![2].strategy!, {wearRate: null, pace: null, gapTrend: null});
    p.push(s);
    const t = text(p.$('.strat'));
    expect(t).toMatch(/Measuring wear rate/);
    expect(t).toMatch(/measured after the first stop by any car/);
    expect(t).toMatch(/Needs a clean lap/);
    expect(t).toMatch(/measuring…/);
    p.push(dashboardState({rivals: []}));
    expect(text(p.$('.strat'))).toBe('Waiting for data');
  });
});

describe('recording', () => {
  test('button state, elapsed time, and the saved-file message', async () => {
    const p = await boot();
    p.push(dashboardState({recording: {available: false, active: false}}));
    expect(p.$<HTMLButtonElement>('.rec')!.disabled).toBe(true);
    p.push(dashboardState());
    p.click('.rec');
    expect(p.sent().at(-1)).toEqual({record: true});
    p.push(dashboardState({recording: {available: true, active: true, seconds: 75, packets: 12345}}));
    expect(p.$('.rectext')!.textContent).toBe('1:15 · 12,345 pkts');
    expect(p.$('.rec')!.classList.contains('on')).toBe(true);
    p.push(dashboardState({recording: {available: true, active: false, lastFile: 'recordings/a.jsonl', lastBytes: 2097152, lastPackets: 900}}));
    expect(text(p.$('.toast'))).toMatch(/Saved recordings\/a\.jsonl · 2\.0 MB · 900 packets Replay: npm run replay -- recordings\/a\.jsonl/);
  });
});

describe('track map', () => {
  test('a new session forgets the old track', async () => {
    const p = await boot();
    p.push(dashboardState());
    expect(buffers.track.size).toBeGreaterThan(0);
    p.push(dashboardState({session: {...dashboardState().session!, sessionUID: 'next'}, rivals: []}));
    expect(buffers.track.size).toBe(0);
  });
  test('the legend shows only with active aero or DRS zones', async () => {
    const p = await boot();
    const s = dashboardState();
    p.push(s);
    expect(p.$('.maplegend')).not.toBeNull();
    p.push(dashboardState({session: {...s.session!, aeroZones: [], drsZones: []}}));
    expect(p.$('.maplegend')).toBeNull();
  });
});

describe('F1 26 (UDP format 2026)', () => {
  const t2 = (o = {}) => ({
    m_activeAeroMode: 0, m_activeAeroAvailable: 1, m_activeAeroActivationDistance: 0, m_overtakeAvailable: 0,
    m_overtakeActive: 0, m_overtakeActivationDistance: 0, m_2026Regulations: 1, m_drivingWrongWay: 0, ...o,
  });
  test('2026 cars show a battery instead of DRS; it glows while in ERS Boost', async () => {
    const p = await boot();
    const base = dashboardState();
    const status = (mode: number, store = 2000000) => ({...base.status!, m_ersDeployMode: mode, m_ersStoreEnergy: store});
    const bat = () => p.$('.driving .bat')!;
    const drs = () => p.$('.driving .drs:not(.aero)');
    const aero = () => p.$('.driving .drs.aero');
    p.push({...base, status: status(3), telemetry2: t2({m_overtakeAvailable: 1, m_overtakeActive: 1, m_activeAeroMode: 1})});
    expect(drs(), 'no overtake badge').toBeNull();
    expect(bat().querySelector('.batpct')!.textContent).toBe('50');
    expect(bat().querySelector<HTMLElement>('.batfill')!.style.width).toBe('50%');
    expect(bat().classList.contains('boost')).toBe(true);
    expect(bat().title).toMatch(/overtake mode in use/);
    expect(bat().querySelector('.batlbl')!.textContent, 'ERS mode named under the battery').toBe('BOOST');
    expect(aero()!.textContent).toBe('STRAIGHT');
    expect(aero()!.classList.contains('on')).toBe(true);
    // regression: the game sets available = active all race; without Boost the battery stays calm
    p.push({...base, status: status(1), telemetry2: t2({m_overtakeAvailable: 1, m_overtakeActive: 1})});
    expect(bat().classList.contains('boost')).toBe(false);
    expect(bat().querySelector('.batlbl')!.textContent).toBe('MEDIUM');
    expect(bat().title).toMatch(/ERS mode: MEDIUM/);
    expect(aero()!.textContent).toBe('CORNER');
    expect(aero()!.classList.contains('on')).toBe(false);
    p.push({...base, status: status(3), telemetry2: t2({m_overtakeAvailable: 1, m_overtakeActive: 1, m_overtakeActivationDistance: 150})});
    expect(bat().classList.contains('boost'), 'ERS Boost glows whatever the overtake flags say').toBe(true);
    p.push({...base, status: status(3), telemetry2: t2({})});
    expect(bat().classList.contains('boost'), 'even with the flags clear').toBe(true);
    p.push({...base, status: status(1), telemetry2: t2({m_overtakeAvailable: 1, m_overtakeActive: 1, m_overtakeActivationDistance: 150})});
    expect(bat().classList.contains('boost'), 'countdown running, not in Boost').toBe(false);
    expect(bat().title).toMatch(/available in 150 m/);
    p.push({...base, status: status(1, 300000), telemetry2: t2({})});
    expect(bat().classList.contains('low'), 'under 15% turns red').toBe(true);
    p.push({...base, status: status(1, 9e9), telemetry2: t2({})});
    expect(bat().querySelector<HTMLElement>('.batfill')!.style.width, 'clamped').toBe('100%');
    // aero does not need m_activeAeroAvailable
    p.push({...base, telemetry2: t2({m_activeAeroAvailable: 0, m_activeAeroMode: 1})});
    expect(aero()!.textContent).toBe('STRAIGHT');
    p.push({...base, telemetry2: t2({m_2026Regulations: 0})});
    expect(aero()).toBeNull();
    expect(drs()!.textContent, 'pre-2026 cars keep DRS').toBe('DRS');
    expect(p.$('.driving .bat'), 'battery still shown').not.toBeNull();
    p.push(dashboardState({telemetry2: null, status: null}));
    expect(p.$('.driving .bat'), 'no status, no battery').toBeNull();
  });
  test('wrong-way warning, reaction time, format chip and ERS boost', async () => {
    const p = await boot();
    const s = dashboardState({telemetry2: t2({m_drivingWrongWay: 1})});
    p.push({...s, status: {...s.status!, m_ersDeployMode: 3}});
    expect(p.$('.wrongway')).not.toBeNull();
    expect(p.$('.reaction')!.textContent).toBe('REACTION 0.214s');
    expect(p.$('.chip.fmt')).not.toBeNull();
    expect(p.$('.tyres .ersmode')!.textContent).toBe('Boost · 8.5 MJ/lap');
    p.push(dashboardState({session: {...s.session!, packetFormat: 2025, reactionTime: 0, aeroZones: [], drsZones: []}}));
    expect(p.$('.chip.fmt')).toBeNull();
    expect(p.$('.reaction')).toBeNull();
  });
  test('standings tag cars using overtake mode or driving the wrong way', async () => {
    const p = await boot();
    const s = dashboardState();
    s.rivals![8].wrongWay = 1;
    p.push(s);
    expect(row(p, 4).querySelector('.tag.ot')).not.toBeNull();
    expect(row(p, 8).querySelector('.n')!.textContent).toMatch(/WRONG WAY/);
  });
  test('the rival popup and compare columns show the same battery', async () => {
    const p = await boot();
    const s = dashboardState();
    const boosting = <D extends ReturnType<typeof detailFor>>(d: D) => ({...d, status: {...d.status, m_ersDeployMode: 3, m_ersStoreEnergy: 1000000}});
    p.push(s);
    p.click(row(p, 1));
    p.push({...s, detail: boosting({...detailFor(s, 1), telemetry2: t2({m_overtakeActive: 1, m_activeAeroMode: 1})})});
    expect(p.$('.dmbox .drs:not(.aero)')).toBeNull();
    expect(p.$('.dmbox .bat')!.classList.contains('boost')).toBe(true);
    expect(p.$('.dmbox .batpct')!.textContent).toBe('25');
    expect(p.$('.dmbox .drs.aero')!.textContent).toBe('STRAIGHT');
    p.key(document, 'Escape');
    p.click('.comparebtn');
    p.push({
      ...s,
      compare: [boosting({...detailFor(s, 2), telemetry2: t2({m_overtakeActive: 1})}), {...detailFor(s, 1), status: {...s.status!, m_ersDeployMode: 2}, telemetry2: null}],
    });
    const [you, nor] = p.$$('.cc');
    expect(you.querySelector('.ccbat')!.classList.contains('boost')).toBe(true);
    expect(you.querySelector('.ccdrs')).toBeNull();
    expect(nor.querySelector('.ccbat')!.classList.contains('boost')).toBe(false);
    expect(nor.querySelector('.ccdrs')!.textContent).toBe('DRS');
  });
  test('battery: blue with overtake mode, otherwise green with charge and red when empty', async () => {
    const p = await boot();
    const base = dashboardState();
    const over = (o = {}) => t2({m_activeAeroAvailable: 0, m_overtakeAvailable: 1, m_overtakeActive: 1, ...o});
    const push = (type: number, mode: number, store: number, o = {}) =>
      p.push({...base, session: {...base.session!, sessionType: type}, status: {...base.status!, m_ersDeployMode: mode, m_ersStoreEnergy: store}, telemetry2: over(o)});
    const colour = () => {
      const b = p.$('.driving .bat')!;
      return b.classList.contains('ot') ? 'blue' : b.classList.contains('low') ? 'red' : 'green';
    };
    push(15, 1, 2000000);
    expect(colour(), 'race, overtake available').toBe('blue');
    expect(p.$('.driving .bat')!.title).toMatch(/overtake mode available/);
    push(15, 1, 100000);
    expect(colour(), 'having overtake wins over a low charge').toBe('blue');
    push(15, 3, 2000000);
    expect(colour(), 'in use').toBe('blue');
    push(15, 1, 2000000, {m_overtakeActivationDistance: 120});
    expect(colour(), 'countdown running: no overtake, has charge').toBe('green');
    push(15, 1, 100000, {m_overtakeAvailable: 0, m_overtakeActive: 0});
    expect(colour(), 'no overtake, nearly empty').toBe('red');
    push(5, 1, 2000000);
    expect(colour(), 'qualifying: the always-on flag is ignored').toBe('green');
    push(5, 3, 2000000);
    expect(colour(), 'but Boost in use still counts').toBe('blue');
  });
});

describe('replay mode', () => {
  const replay = (o = {}) => ({file: 'race.jsonl', playing: true, finished: false, speed: 1, loop: false, pos: 65000, duration: 600000, packets: 9000, ...o});
  const sentReplay = (p: Page) => p.sent().filter(m => m.replay).map(m => m.replay);

  test('live and demo show no replay UI', async () => {
    const p = await boot();
    expect(p.$('.replaychip'), 'hidden before any data').toBeNull();
    p.push(dashboardState());
    expect(p.$('.replaychip')).toBeNull();
    expect(p.$('.rp')).toBeNull();
    expect(document.body.classList.contains('replaying')).toBe(false);
    expect(p.$('.conntext')!.textContent).toBe('LIVE');
  });
  test('header badge makes the replay obvious, with speed and position', async () => {
    const p = await boot();
    p.push(dashboardState({replay: replay({speed: 2})}));
    expect(p.$('.replaychip')!.textContent).toMatch(/REPLAY/);
    expect(p.$('.replayinfo')!.textContent).toBe('2× · 1:05 / 10:00');
    expect(document.body.classList.contains('replaying')).toBe(true);
    expect(p.$('.conntext')!.textContent).toBe('REPLAY');
    p.push(dashboardState({replay: replay({playing: false})}));
    expect(p.$('.replayinfo')!.textContent).toBe('PAUSED · 1:05 / 10:00');
    expect(p.$('.replaychip')!.classList.contains('paused')).toBe(true);
    p.push(dashboardState({replay: replay({playing: false, finished: true, pos: 600000})}));
    expect(p.$('.replayinfo')!.textContent).toBe('ENDED · 10:00 / 10:00');
    expect(p.$('.conntext')!.textContent).toBe('REPLAY ENDED');
    p.push(dashboardState());
    expect(p.$('.replaychip'), 'badge goes away when not replaying').toBeNull();
    expect(document.body.classList.contains('replaying')).toBe(false);
  });
  test('the waiting screen never covers a replay', async () => {
    const p = await boot();
    p.push(dashboardState({hasData: false, setup: {ips: [], udpPort: 20777}, replay: replay()}));
    expect(p.$('.wait')).toBeNull();
  });
  test('floating popup shows the file, position, play state, loop and speed', async () => {
    const p = await boot();
    p.push(dashboardState({replay: replay({speed: 3, loop: true})}));
    expect(p.$('.rpfile')!.textContent).toBe('race.jsonl');
    expect(p.$('.rppos')!.textContent).toBe('1:05');
    expect(p.$('.rpdur')!.textContent).toBe('10:00');
    expect(p.$<HTMLInputElement>('.rpscrub input')!.value).toBe('108');
    expect(p.$('.rpplay')!.textContent).toBe('⏸');
    expect(p.$('[title="Loop the recording"]')!.classList.contains('on')).toBe(true);
    expect(p.$$('.rpspeeds button.on').map(b => b.textContent)).toEqual(['3×']);
    expect(p.$$('.rpspeeds button').length).toBe(7);
    p.push(dashboardState({replay: replay({playing: false, duration: 0, pos: 0})}));
    expect(p.$('.rpplay')!.textContent).toBe('▶');
    expect(p.$<HTMLInputElement>('.rpscrub input')!.value, 'empty recording does not divide by zero').toBe('0');
  });
  test('buttons send player commands', async () => {
    const p = await boot();
    p.push(dashboardState({replay: replay()}));
    for (const title of ['Play / pause', 'Back to start', 'Back 10 s', 'Forward 10 s', 'Loop the recording']) p.click(`.rp [title="${title}"]`);
    p.click('.rpspeeds [data-speed="5"]');
    expect(sentReplay(p)).toEqual([
      {action: 'toggle'}, {action: 'restart'}, {action: 'skip', value: -10000}, {action: 'skip', value: 10000},
      {action: 'loop', value: true}, {action: 'speed', value: 5},
    ]);
    p.push(dashboardState({replay: replay({loop: true})}));
    p.click('.rp [title="Loop the recording"]');
    expect(sentReplay(p).at(-1), 'toggles loop off').toEqual({action: 'loop', value: false});
  });
  test('scrubbing seeks on release and does not fight the live position', async () => {
    const p = await boot();
    p.push(dashboardState({replay: replay()}));
    const seek = p.$<HTMLInputElement>('.rpscrub input')!;
    const {fireEvent} = await import('@testing-library/react');
    act(() => void fireEvent.input(seek, {target: {value: '500'}}));
    expect(p.$('.rppos')!.textContent, 'time follows the thumb').toBe('5:00');
    p.push(dashboardState({replay: replay({pos: 70000})}));
    expect(seek.value, 'server updates are held while scrubbing').toBe('500');
    act(() => void seek.dispatchEvent(new Event('change')));
    expect(sentReplay(p)).toEqual([{action: 'seek', value: 300000}]);
    p.push(dashboardState({replay: replay({pos: 150000})}));
    expect(seek.value, 'following the server again').toBe('250');
  });
  test('controls do nothing without a connection', async () => {
    const p = await boot();
    p.push(dashboardState({replay: replay()}));
    p.socket().readyState = 3;
    p.click('.rpplay');
    expect(sentReplay(p)).toEqual([]);
  });
  test('collapse button hides the controls, and dragging moves and remembers the popup', async () => {
    const p = await boot();
    p.push(dashboardState({replay: replay()}));
    p.click('.rpmin');
    expect(p.$('.rp')!.classList.contains('collapsed')).toBe(true);
    p.click('.rpmin');
    expect(p.$('.rp')!.classList.contains('collapsed')).toBe(false);
    const box = p.$('.rp')!;
    box.getBoundingClientRect = () => ({left: 600, top: 500, width: 340, height: 200}) as DOMRect;
    Object.defineProperty(box, 'offsetWidth', {value: 340});
    Object.defineProperty(box, 'offsetHeight', {value: 200});
    const head = p.$('.rphead')!;
    p.pointer(p.$('.rpmin')!, 'pointerdown', {clientX: 700, clientY: 510}); // on a button: no drag
    expect(box.classList.contains('placed')).toBe(false);
    p.pointer(head, 'pointerdown', {clientX: 700, clientY: 510});
    p.pointer(head, 'pointermove', {clientX: 600, clientY: 410});
    expect(box.style.left).toBe('500px');
    expect(box.style.top).toBe('400px');
    p.pointer(head, 'pointermove', {clientX: -5000, clientY: 9000});
    expect(box.style.left, 'kept on screen').toBe('6px');
    expect(box.style.top).toBe(`${900 - 200 - 6}px`);
    p.pointer(head, 'pointerup');
    expect(JSON.parse(localStorage.getItem('pitwall-replay-pos')!)).toEqual({x: 6, y: 694});
    const q = await boot({storage: {'pitwall-replay-pos': '{"x":120,"y":80}'}});
    q.push(dashboardState({replay: replay()}));
    expect(q.$('.rp')!.style.left, 'position restored').toBe('120px');
    const bad = await boot({storage: {'pitwall-replay-pos': 'nope'}});
    bad.push(dashboardState({replay: replay()}));
    expect(bad.$('.rp')!.classList.contains('placed')).toBe(false);
  });
});

describe('saved replays list', () => {
  const recs = [
    {file: 'session-b.jsonl', bytes: 126515802, modified: 1761260000000, startedAt: '2026-10-23T22:55:57.180Z', duration: 539463},
    {file: 'session-a.jsonl', bytes: 1048576, modified: 1761250000000, startedAt: null, duration: null},
  ];
  // fetch and window.open stubs; `tab` records what the new tab was told to do
  function stubs({list = recs as typeof recs | null, openResult = {port: 4567, file: 'session-b.jsonl'} as object, openStatus = 200, blocked = false} = {}) {
    const calls: [string, RequestInit | undefined][] = [];
    const tab = {written: '', href: '', closed: false, document: {write(h: string) { tab.written += h; }}, location: {set href(v: string) { tab.href = v; }}, close() { tab.closed = true; }};
    const opened: unknown[][] = [];
    vi.stubGlobal('open', (...a: unknown[]) => { opened.push(a); return blocked ? null : tab; });
    vi.stubGlobal('fetch', async (url: string, opts?: RequestInit) => {
      calls.push([url, opts]);
      if (opts?.method === 'POST') return {ok: openStatus === 200, status: openStatus, json: async () => openResult};
      if (list === null) return {ok: false, status: 500, json: async () => ({})};
      return {ok: true, status: 200, json: async () => list};
    });
    return {calls, tab, opened};
  }
  const settle = () => act(async () => {});
  const openList = async (p: Page) => {
    p.click('.replaysbtn');
    await settle();
  };
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  test('the button opens a list of recordings, newest first, with length and size', async () => {
    const p = await boot();
    stubs();
    await openList(p);
    const rows = p.$$('.rlrow');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toMatch(/8:59/);
    expect(rows[0].textContent).toMatch(/120\.7 MB/);
    expect(rows[0].textContent).toMatch(/session-b\.jsonl/);
    expect(rows[1].textContent, 'unknown length').toMatch(/–/);
    expect(p.$('.rlnote')!.textContent).toMatch(/Opens in a new tab/);
  });
  test('empty and failing lists say so', async () => {
    const p = await boot();
    stubs({list: []});
    await openList(p);
    expect(p.$$('.rlrow').length).toBe(0);
    expect(p.$('.rlnote')!.textContent).toMatch(/No recordings yet/);
    p.click('.rlhead button');
    stubs({list: null});
    await openList(p);
    expect(p.$('.rlnote')!.textContent).toMatch(/Could not load/);
  });
  test('choosing a recording opens a new tab and points it at the replay', async () => {
    const p = await boot();
    const s = stubs();
    await openList(p);
    p.click('.rlrow');
    expect(s.opened.length, 'tab opened inside the click').toBe(1);
    expect(s.tab.written).toMatch(/Loading replay/);
    await settle();
    const post = s.calls.find(c => c[1]?.method === 'POST')!;
    expect(post[0]).toBe('/api/replays');
    expect(JSON.parse(post[1]!.body as string)).toEqual({file: 'session-b.jsonl'});
    expect(s.tab.href).toBe('http://localhost:4567/');
    expect(p.$('.rlbox'), 'list closes').toBeNull();
    expect(s.tab.closed).toBe(false);
  });
  test('a failed open closes the blank tab and explains', async () => {
    const p = await boot();
    const s = stubs({openStatus: 404, openResult: {error: 'No such recording'}});
    await openList(p);
    p.click('.rlrow');
    await settle();
    expect(s.tab.closed).toBe(true);
    expect(p.$('.rlbox'), 'list stays open to pick another').not.toBeNull();
    expect(p.$('.rlnote')!.textContent).toMatch(/Could not open the replay: No such recording/);
  });
  test('a blocked popup falls back to opening the address', async () => {
    const p = await boot();
    const s = stubs({blocked: true});
    await openList(p);
    p.click('.rlrow');
    await settle();
    expect(s.opened.length, 'tried again once the address was known').toBe(2);
    expect(s.opened[1][0]).toBe('http://localhost:4567/');
  });
  test('closing: the x, the backdrop and Escape; clicking inside the box keeps it open', async () => {
    const p = await boot();
    stubs();
    await openList(p);
    p.click('.rlhead button');
    expect(p.$('.rlover')).toBeNull();
    await openList(p);
    p.click('.rlbox');
    expect(p.$('.rlover')).not.toBeNull();
    p.click('.rlover');
    expect(p.$('.rlover')).toBeNull();
    await openList(p);
    p.key(document, 'Escape');
    expect(p.$('.rlover')).toBeNull();
  });
  test('the button is there on the live dashboard but not inside a replay', async () => {
    const p = await boot();
    p.push(dashboardState());
    expect(p.$('.replaysbtn')).not.toBeNull();
    p.push(dashboardState({replay: {file: 'x.jsonl', playing: true, finished: false, speed: 1, loop: false, pos: 0, duration: 1000, packets: 5}}));
    expect(p.$('.replaysbtn')).toBeNull();
    p.push(dashboardState());
    expect(p.$('.replaysbtn')).not.toBeNull();
  });
});

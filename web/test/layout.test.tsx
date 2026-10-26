// Resizable sections and the Layout dialog. Ported from test/layout.test.js. jsdom has no layout engine, so
// element sizes are stubbed.
import {describe, expect, test} from 'vitest';
import {boot, media, type Page} from './helpers';

const KEY = 'pitwall-layout-v1';
const ARRANGE = 'pitwall-arrangement-v1';
const DEFAULT = [['p-driving', 'p-tyres'], ['p-lap', 'p-map'], ['p-standings', 'p-strategy']];

// column widths and section heights the "browser" reports
const SIZES: Record<string, [number, number]> = {c1: [600, 900], c2: [400, 900], c3: [300, 900], 'p-driving': [600, 450], 'p-tyres': [600, 450]};
function stubSizes(sizes = SIZES) {
  for (const [id, [width, height]] of Object.entries(sizes)) {
    const el = document.getElementById(id);
    if (el) el.getBoundingClientRect = () => ({width, height}) as DOMRect;
  }
}
async function page(opts: Parameters<typeof boot>[0] = {}) {
  const p = await boot(opts);
  stubSizes();
  return p;
}
const el = (id: string) => document.getElementById(id)!;
const weight = (id: string) => parseFloat(el(id).style.flex);
const saved = () => JSON.parse(localStorage.getItem(KEY)!);
const splitAfter = (id: string) => el(id).nextElementSibling as HTMLElement;
/** The dashboard as laid out: section ids per column. */
const dashboard = () => [...document.querySelectorAll('main > .col')].map(col => [...col.querySelectorAll(':scope > .card')].map(c => c.id));
const mainKids = () => [...document.querySelector('main')!.children].map(e => (e.classList.contains('split') ? 'split-' + (e as HTMLElement).dataset.dir : e.id));
const dialogCols = (p: Page) => p.$$('.locol').map(c => [...c.querySelectorAll<HTMLElement>('.lotile')].map(t => t.dataset.id));
const tile = (p: Page, id: string) => p.$(`.lotile[data-id="${id}"]`)!;

// the dialog's boxes: column i spans x 200i..200i+180, its tile k spans y 50+60k..+50
function stubDialog(p: Page) {
  p.$$('.locol').forEach((col, i) => {
    col.getBoundingClientRect = () => ({left: i * 200, right: i * 200 + 180, top: 0, bottom: 400, width: 180, height: 400}) as DOMRect;
    col.querySelectorAll<HTMLElement>('.lotile').forEach((t, k) => {
      t.getBoundingClientRect = () => ({left: i * 200, right: i * 200 + 180, top: 50 + k * 60, bottom: 100 + k * 60, width: 180, height: 50}) as DOMRect;
    });
  });
}
function dragTile(p: Page, id: string, to: {x: number; y: number}, {release = true} = {}) {
  stubDialog(p);
  const t = tile(p, id);
  const r = t.getBoundingClientRect();
  p.pointer(t, 'pointerdown', {clientX: r.left + 10, clientY: r.top + 10});
  p.pointer(t, 'pointermove', {clientX: to.x, clientY: to.y});
  if (release) p.pointer(t, 'pointerup', {clientX: to.x, clientY: to.y});
  return t;
}

describe('dragging dividers', () => {
  test('column divider moves the boundary and remembers every column', async () => {
    const p = await page();
    const split = splitAfter('c1');
    expect(split.dataset.dir).toBe('x');
    p.pointer(split, 'pointerdown', {clientX: 600});
    expect(split.classList.contains('drag')).toBe(true);
    expect(document.body.classList.contains('resizing-x')).toBe(true);
    p.pointer(split, 'pointermove', {clientX: 700});
    expect(weight('c1')).toBe(700);
    expect(weight('c2')).toBe(300);
    expect(weight('c3'), 'the third column is frozen at its size').toBe(300);
    p.pointer(split, 'pointerup');
    expect(split.classList.contains('drag')).toBe(false);
    expect(document.body.classList.contains('resizing-x')).toBe(false);
    expect(saved()).toEqual({c1: 700, c2: 300, c3: 300});
  });
  test('sizes stop at the minimum', async () => {
    const p = await page();
    const split = splitAfter('c1');
    p.pointer(split, 'pointerdown', {clientX: 600});
    p.pointer(split, 'pointermove', {clientX: -500});
    expect(weight('c1')).toBe(220);
    expect(weight('c2')).toBe(780);
    p.pointer(split, 'pointermove', {clientX: 5000});
    expect(weight('c2')).toBe(220);
    p.pointer(split, 'pointercancel');
  });
  test('section divider resizes heights', async () => {
    const p = await page();
    const split = splitAfter('p-driving');
    expect(split.dataset.dir).toBe('y');
    p.pointer(split, 'pointerdown', {clientY: 450});
    p.pointer(split, 'pointermove', {clientY: 350});
    p.pointer(split, 'pointerup');
    expect(saved()).toEqual({'p-driving': 350, 'p-tyres': 550});
    expect(document.body.classList.contains('resizing-y')).toBe(false);
  });
  test('ignored on narrow (stacked) screens', async () => {
    const p = await page({desktop: false});
    p.pointer(splitAfter('c1'), 'pointerdown', {clientX: 600});
    expect(el('c1').style.flex).toBe('');
  });
});

describe('keyboard', () => {
  test('arrow keys move a focused divider along its own axis only', async () => {
    const p = await page();
    p.key(splitAfter('c1'), 'ArrowRight');
    expect(weight('c1')).toBe(624);
    stubSizes({...SIZES, c1: [624, 900], c2: [376, 900]});
    p.key(splitAfter('c1'), 'ArrowUp');
    expect(weight('c1'), 'up/down ignored on a column divider').toBe(624);
    p.key(splitAfter('p-driving'), 'ArrowUp');
    expect(weight('p-driving')).toBe(426);
    p.key(splitAfter('p-driving'), 'ArrowLeft');
    expect(weight('p-driving'), 'left/right ignored on a section divider').toBe(426);
    expect(saved().c1).toBe(624);
  });
});

describe('persistence', () => {
  test('saved sizes are restored on load, unknown or broken data ignored', async () => {
    await page({storage: {[KEY]: JSON.stringify({c1: 500, c2: 250, nope: 3})}});
    expect(weight('c1')).toBe(500);
    expect(weight('c2')).toBe(250);
    expect(el('c3').style.flex).toBe('');
    await page({storage: {[KEY]: '{oops'}});
    expect(el('c1').style.flex).toBe('');
  });
  test('switching to a narrow screen clears sizes; back to desktop restores them', async () => {
    await page({storage: {[KEY]: JSON.stringify({c1: 500})}});
    media.set(false);
    expect(el('c1').style.flex).toBe('');
    media.set(true);
    expect(weight('c1')).toBe(500);
  });
  test('"Reset section sizes" in the Layout dialog clears every size', async () => {
    const p = await page({storage: {[KEY]: JSON.stringify({c1: 500, 'p-driving': 300})}});
    expect(weight('c1')).toBe(500);
    p.click('.layoutbtn');
    p.click('.lochk input');
    p.click('.lobtn.save');
    expect(el('c1').style.flex).toBe('');
    expect(el('p-driving').style.flex).toBe('');
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe('layout dialog', () => {
  test('the Layout button opens the dialog with the current arrangement and section names', async () => {
    const p = await page();
    expect(p.$('.lobox')).toBeNull();
    p.click('.layoutbtn');
    expect(dialogCols(p)).toEqual(DEFAULT);
    expect(p.$$('.loname').map(n => n.textContent)).toEqual(['Driving', 'Tyres & car', 'Lap timing', 'Track map', 'Standings', 'Strategy']);
    expect(document.activeElement, 'keyboard users start on the first section').toBe(tile(p, 'p-driving'));
    expect(tile(p, 'p-map').getAttribute('aria-label')).toMatch(/^Track map: column 2 of 3, position 2 of 2\./);
    expect(p.$<HTMLButtonElement>('.lodefault')!.disabled, 'already the default').toBe(true);
  });
  test('dragging a section to another column shows where it lands, then moves it', async () => {
    const p = await page();
    p.click('.layoutbtn');
    const t = dragTile(p, 'p-standings', {x: 10, y: 70}, {release: false}); // column 1, above the middle of its first tile
    expect(t.classList.contains('dragging')).toBe(true);
    const ghost = p.$('.loghost')!;
    expect(ghost.textContent).toBe('Standings');
    expect(ghost.style.left).toBe('10px');
    expect(p.$('.locol .lodrop')!.nextElementSibling, 'marker above Driving').toBe(tile(p, 'p-driving'));
    expect(document.body.classList.contains('lodragging')).toBe(true);
    p.pointer(t, 'pointerup', {clientX: 10, clientY: 70});
    expect(dialogCols(p)).toEqual([['p-standings', 'p-driving', 'p-tyres'], ['p-lap', 'p-map'], ['p-strategy']]);
    expect(p.$('.loghost')).toBeNull();
    expect(p.$('.lodrop')).toBeNull();
    expect(document.body.classList.contains('lodragging')).toBe(false);
    expect(document.activeElement, 'focus follows the moved section').toBe(tile(p, 'p-standings'));
    expect(dashboard(), 'nothing changes on the dashboard before Save').toEqual(DEFAULT);
    expect(p.$<HTMLButtonElement>('.lodefault')!.disabled).toBe(false);
  });
  test('dropping below every section puts it last; dropping beside the columns uses the nearest one', async () => {
    const p = await page();
    p.click('.layoutbtn');
    dragTile(p, 'p-driving', {x: 250, y: 390});
    expect(dialogCols(p)).toEqual([['p-tyres'], ['p-lap', 'p-map', 'p-driving'], ['p-standings', 'p-strategy']]);
    dragTile(p, 'p-lap', {x: 5000, y: 60});
    expect(dialogCols(p)).toEqual([['p-tyres'], ['p-map', 'p-driving'], ['p-lap', 'p-standings', 'p-strategy']]);
    dragTile(p, 'p-tyres', {x: 190, y: 160});
    expect(dialogCols(p)).toEqual([['p-tyres'], ['p-map', 'p-driving'], ['p-lap', 'p-standings', 'p-strategy']]);
  });
  test('a press without moving is not a drag; a cancelled drag changes nothing', async () => {
    const p = await page();
    p.click('.layoutbtn');
    stubDialog(p);
    const t = tile(p, 'p-map');
    p.pointer(t, 'pointerdown', {clientX: 210, clientY: 120});
    p.pointer(t, 'pointermove', {clientX: 212, clientY: 121});
    expect(p.$('.loghost'), 'under the drag threshold').toBeNull();
    p.pointer(t, 'pointerup', {clientX: 212, clientY: 121});
    expect(dialogCols(p)).toEqual(DEFAULT);
    dragTile(p, 'p-map', {x: 10, y: 60}, {release: false});
    p.pointer(tile(p, 'p-map'), 'pointercancel');
    expect(dialogCols(p)).toEqual(DEFAULT);
    expect(p.$('.loghost')).toBeNull();
    p.pointer(tile(p, 'p-map'), 'pointerdown', {clientX: 0, clientY: 0, button: 2});
    p.pointer(tile(p, 'p-map'), 'pointermove', {clientX: 300, clientY: 300});
    expect(p.$('.loghost'), 'right button does not drag').toBeNull();
  });
  test('arrow keys move the focused section; moves off the edge are ignored', async () => {
    const p = await page();
    p.click('.layoutbtn');
    const keyOn = (id: string, key: string) => p.key(tile(p, id), key);
    keyOn('p-driving', 'ArrowDown');
    expect(dialogCols(p)[0]).toEqual(['p-tyres', 'p-driving']);
    expect(document.activeElement).toBe(tile(p, 'p-driving'));
    keyOn('p-driving', 'ArrowDown');
    keyOn('p-tyres', 'ArrowUp');
    keyOn('p-tyres', 'ArrowLeft');
    keyOn('p-strategy', 'ArrowRight');
    keyOn('p-strategy', 'Enter');
    expect(dialogCols(p), 'edges and other keys ignored').toEqual([['p-tyres', 'p-driving'], ['p-lap', 'p-map'], ['p-standings', 'p-strategy']]);
    keyOn('p-driving', 'ArrowRight');
    expect(dialogCols(p), 'same height in the next column').toEqual([['p-tyres'], ['p-lap', 'p-driving', 'p-map'], ['p-standings', 'p-strategy']]);
    keyOn('p-standings', 'ArrowLeft');
    expect(dialogCols(p)[1]).toEqual(['p-standings', 'p-lap', 'p-driving', 'p-map']);
  });
  test('columns: add up to four, drop into an empty one, remove an empty one', async () => {
    const p = await page();
    p.click('.layoutbtn');
    p.click('.loaddcol');
    expect(dialogCols(p)).toEqual([...DEFAULT, []]);
    const empty = p.$$('.locol')[3];
    expect(empty.querySelector('.loempty')!.textContent).toBe('Drop a section here');
    expect(empty.querySelector('.lorm'), 'an empty column can be removed').not.toBeNull();
    expect(p.$$('.lorm').length, 'columns with sections cannot').toBe(1);
    expect(p.$<HTMLButtonElement>('.loaddcol')!.disabled, 'four is the most').toBe(true);
    const t = dragTile(p, 'p-map', {x: 610, y: 100}, {release: false});
    const col4 = p.$$('.locol')[3];
    expect(col4.querySelector('.lodrop')!.nextElementSibling, 'marker above the hint').toBe(col4.querySelector('.loempty'));
    p.pointer(t, 'pointerup', {clientX: 610, clientY: 100});
    expect(dialogCols(p)[3]).toEqual(['p-map']);
    p.key(tile(p, 'p-lap'), 'ArrowRight');
    p.key(tile(p, 'p-lap'), 'ArrowRight');
    expect(dialogCols(p)).toEqual([['p-driving', 'p-tyres'], [], ['p-standings', 'p-strategy'], ['p-lap', 'p-map']]);
    p.click('.lorm');
    expect(dialogCols(p)).toEqual([['p-driving', 'p-tyres'], ['p-standings', 'p-strategy'], ['p-lap', 'p-map']]);
    expect(p.$<HTMLButtonElement>('.loaddcol')!.disabled).toBe(false);
  });
  test('Save lays out the dashboard and remembers it', async () => {
    const p = await page();
    p.click('.layoutbtn');
    p.click('.loaddcol');
    dragTile(p, 'p-standings', {x: 610, y: 100});
    p.key(tile(p, 'p-strategy'), 'ArrowLeft');
    p.click('.lobtn.save');
    expect(p.$('.lobox')).toBeNull();
    expect(dashboard(), 'the emptied third column is dropped').toEqual([['p-driving', 'p-tyres'], ['p-strategy', 'p-lap', 'p-map'], ['p-standings']]);
    expect(mainKids()).toEqual(['c1', 'split-x', 'c2', 'split-x', 'c3']);
    expect(el('c2').querySelectorAll(':scope > .split[data-dir="y"]').length, 'a divider between each pair of sections').toBe(2);
    expect(el('p-map').querySelector('canvas.mapcv'), 'with everything in it').not.toBeNull();
    expect(JSON.parse(localStorage.getItem(ARRANGE)!)).toEqual({cols: dashboard()});
  });
  test('Cancel, ✕, Escape and the backdrop close without changing anything', async () => {
    const p = await page();
    const closes = [() => p.click(p.$$('.lofoot .lobtn').find(b => b.textContent === 'Cancel')!), () => p.click('.lobox .rlhead button'), () => p.key(document, 'Escape'), () => p.pointer(p.$('.rlover')!, 'pointerdown')];
    for (const close of closes) {
      p.click('.layoutbtn');
      p.key(tile(p, 'p-driving'), 'ArrowRight');
      close();
      expect(p.$('.lobox')).toBeNull();
      expect(dashboard()).toEqual(DEFAULT);
      expect(localStorage.getItem(ARRANGE)).toBeNull();
    }
    p.click('.layoutbtn');
    expect(dialogCols(p), 'reopening starts from the saved layout, not the abandoned edit').toEqual(DEFAULT);
    p.pointer(p.$('.logrid')!, 'pointerdown');
    expect(p.$('.lobox'), 'a press inside the dialog does not close it').not.toBeNull();
  });
  test('Default layout puts every section back', async () => {
    const custom = {cols: [['p-strategy'], ['p-map', 'p-lap', 'p-driving'], ['p-tyres', 'p-standings']]};
    const p = await page({storage: {[ARRANGE]: JSON.stringify(custom)}});
    p.click('.layoutbtn');
    expect(dialogCols(p)).toEqual(custom.cols);
    p.click('.lodefault');
    expect(dialogCols(p)).toEqual(DEFAULT);
    expect(p.$<HTMLButtonElement>('.lodefault')!.disabled).toBe(true);
    p.click('.lobtn.save');
    expect(dashboard()).toEqual(DEFAULT);
    expect(localStorage.getItem(ARRANGE), 'the default needs no saved copy').toBeNull();
  });
});

describe('saved layout', () => {
  test('a saved arrangement is laid out on load, with working dividers', async () => {
    const custom = {cols: [['p-map', 'p-standings', 'p-lap'], ['p-driving', 'p-tyres', 'p-strategy']]};
    const p = await page({storage: {[ARRANGE]: JSON.stringify(custom)}});
    expect(dashboard()).toEqual(custom.cols);
    expect(mainKids()).toEqual(['c1', 'split-x', 'c2']);
    stubSizes({c1: [700, 900], c2: [500, 900]});
    const split = splitAfter('c1');
    p.pointer(split, 'pointerdown', {clientX: 700});
    p.pointer(split, 'pointermove', {clientX: 650});
    p.pointer(split, 'pointerup');
    expect(saved()).toEqual({c1: 650, c2: 550});
  });
  test('a broken or outdated saved arrangement still shows every section', async () => {
    await page({storage: {[ARRANGE]: '{oops'}});
    expect(dashboard()).toEqual(DEFAULT);
    await page({storage: {[ARRANGE]: JSON.stringify({cols: [['p-map', 'p-gone'], ['p-lap']]})}});
    expect(dashboard()).toEqual([['p-map'], ['p-lap', 'p-driving', 'p-tyres', 'p-standings', 'p-strategy']]);
  });
  test('a new arrangement starts from even sizes; saving the same one keeps them', async () => {
    const p = await page({storage: {[KEY]: JSON.stringify({c1: 500, 'p-driving': 300})}});
    p.click('.layoutbtn');
    p.click('.lobtn.save');
    expect(weight('c1'), 'unchanged layout: sizes kept').toBe(500);
    expect(weight('p-driving')).toBe(300);
    p.click('.layoutbtn');
    p.key(tile(p, 'p-driving'), 'ArrowDown');
    p.click('.lobtn.save');
    expect(el('c1').style.flex).toBe('');
    expect(el('p-driving').style.flex).toBe('');
    expect(localStorage.getItem(KEY)).toBeNull();
  });
  test('on a narrow screen the sections stack in the saved order', async () => {
    const custom = {cols: [['p-standings', 'p-map'], ['p-driving', 'p-tyres', 'p-lap', 'p-strategy']]};
    await page({desktop: false, storage: {[ARRANGE]: JSON.stringify(custom), [KEY]: JSON.stringify({c1: 500})}});
    expect([...document.querySelectorAll('main .card')].map(e => e.id)).toEqual(custom.cols.flat());
    expect(el('c1').style.flex, 'no desktop sizes on a narrow screen').toBe('');
  });
});

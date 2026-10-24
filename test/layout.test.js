// Resizable sections (public/layout.js) in jsdom. jsdom has no layout engine, so element sizes are stubbed.
const {test, describe, afterEach} = require('node:test');
const assert = require('node:assert/strict');
const {loadPage} = require('./helpers');

const KEY = 'pitwall-layout-v1';
const pages = [];
afterEach(() => pages.splice(0).forEach(p => p.close()));
function page(opts) {
  const p = loadPage(opts);
  pages.push(p);
  // column widths and section heights the "browser" reports
  const sizes = {c1: [600, 900], c2: [400, 900], c3: [300, 900], 'p-driving': [600, 450], 'p-tyres': [600, 450]};
  for (const [id, [width, height]] of Object.entries(sizes)) if (p.$(id)) p.$(id).getBoundingClientRect = () => ({width, height});
  return p;
}
const weight = el => parseFloat(el.style.flex);
const saved = p => JSON.parse(p.w.localStorage.getItem(KEY));
const splitBetween = (p, a) => p.$(a).nextElementSibling;

describe('dragging dividers', () => {
  test('column divider moves the boundary and remembers every column', () => {
    const p = page();
    const split = splitBetween(p, 'c1');
    assert.equal(split.dataset.dir, 'x');
    p.pointer(split, 'pointerdown', {clientX: 600});
    assert.equal(split.classList.contains('drag'), true);
    assert.equal(p.doc.body.classList.contains('resizing-x'), true);
    p.pointer(split, 'pointermove', {clientX: 700});
    assert.equal(weight(p.$('c1')), 700);
    assert.equal(weight(p.$('c2')), 300);
    assert.equal(weight(p.$('c3')), 300, 'the third column is frozen at its size');
    p.pointer(split, 'pointerup');
    assert.equal(split.classList.contains('drag'), false);
    assert.equal(p.doc.body.classList.contains('resizing-x'), false);
    assert.deepEqual(saved(p), {c1: 700, c2: 300, c3: 300});
  });
  test('sizes stop at the minimum', () => {
    const p = page();
    const split = splitBetween(p, 'c1');
    p.pointer(split, 'pointerdown', {clientX: 600});
    p.pointer(split, 'pointermove', {clientX: -500});
    assert.equal(weight(p.$('c1')), 220);
    assert.equal(weight(p.$('c2')), 780);
    p.pointer(split, 'pointermove', {clientX: 5000});
    assert.equal(weight(p.$('c2')), 220);
    p.pointer(split, 'pointercancel');
  });
  test('section divider resizes heights', () => {
    const p = page();
    const split = splitBetween(p, 'p-driving');
    assert.equal(split.dataset.dir, 'y');
    p.pointer(split, 'pointerdown', {clientY: 450});
    p.pointer(split, 'pointermove', {clientY: 350});
    p.pointer(split, 'pointerup');
    assert.deepEqual(saved(p), {'p-driving': 350, 'p-tyres': 550});
    assert.equal(p.doc.body.classList.contains('resizing-y'), false);
  });
  test('ignored on narrow (stacked) screens', () => {
    const p = page({desktop: false});
    p.pointer(splitBetween(p, 'c1'), 'pointerdown', {clientX: 600});
    assert.equal(p.$('c1').style.flex, '');
  });
});

describe('keyboard', () => {
  test('arrow keys move a focused divider along its own axis only', () => {
    const p = page();
    const x = splitBetween(p, 'c1'), y = splitBetween(p, 'p-driving');
    p.key(x, 'ArrowRight');
    assert.equal(weight(p.$('c1')), 624);
    p.key(x, 'ArrowUp');
    assert.equal(weight(p.$('c1')), 624, 'up/down ignored on a column divider');
    p.key(y, 'ArrowUp');
    assert.equal(weight(p.$('p-driving')), 426);
    p.key(y, 'ArrowLeft');
    assert.equal(weight(p.$('p-driving')), 426, 'left/right ignored on a section divider');
    p.key(y, 'Enter');
    assert.equal(saved(p).c1, 624);
  });
});

describe('persistence', () => {
  test('saved sizes are restored on load, unknown or broken data ignored', () => {
    const p = page({storage: {[KEY]: JSON.stringify({c1: 500, c2: 250, nope: 3})}});
    assert.equal(weight(p.$('c1')), 500);
    assert.equal(weight(p.$('c2')), 250);
    assert.equal(p.$('c3').style.flex, '');
    const broken = page({storage: {[KEY]: '{oops'}});
    assert.equal(broken.$('c1').style.flex, '');
  });
  test('switching to a narrow screen clears sizes; back to desktop restores them', () => {
    const p = page({storage: {[KEY]: JSON.stringify({c1: 500})}});
    p.setDesktop(false);
    assert.equal(p.$('c1').style.flex, '');
    p.setDesktop(true);
    assert.equal(weight(p.$('c1')), 500);
  });
  test('"Reset section sizes" in the Layout dialog clears every size', () => {
    const p = page({storage: {[KEY]: JSON.stringify({c1: 500, 'p-driving': 300})}});
    assert.equal(weight(p.$('c1')), 500);
    p.$('layoutBtn').click();
    p.$('loSizes').click();
    p.$('loSave').click();
    assert.equal(p.$('c1').style.flex, '');
    assert.equal(p.$('p-driving').style.flex, '');
    assert.equal(p.w.localStorage.getItem(KEY), null);
  });
});

// --- Layout dialog: arrange sections by drag and drop ---
const ARRANGE = 'pitwall-arrangement-v1';
const DEFAULT = [['p-driving', 'p-tyres'], ['p-lap', 'p-map'], ['p-standings', 'p-strategy']];
// the dashboard as it is laid out: section ids per column, and the dividers between them
const dashboard = p => [...p.doc.querySelector('main').children].filter(el => el.classList.contains('col'))
  .map(col => [...col.children].filter(el => el.classList.contains('card')).map(el => el.id));
const mainKids = p => [...p.doc.querySelector('main').children].map(el => (el.classList.contains('split') ? 'split-' + el.dataset.dir : el.id));
// the dialog's columns, and its tiles' names
const dialogCols = p => [...p.$('loGrid').querySelectorAll('.locol')].map(c => [...c.querySelectorAll('.lotile')].map(t => t.dataset.id));
const tileFor = (p, id) => p.$('loGrid').querySelector(`.lotile[data-id="${id}"]`);
// sizes for the dialog's boxes: column i spans x 200i..200i+180, its tile k spans y 50+60k..+50
function stubDialog(p) {
  p.$('loGrid').querySelectorAll('.locol').forEach((col, i) => {
    col.getBoundingClientRect = () => ({left: i * 200, right: i * 200 + 180, top: 0, bottom: 400, width: 180, height: 400});
    col.querySelectorAll('.lotile').forEach((t, k) => {
      t.getBoundingClientRect = () => ({left: i * 200, right: i * 200 + 180, top: 50 + k * 60, bottom: 100 + k * 60, width: 180, height: 50});
    });
  });
}
function dragTile(p, id, to, {release = true} = {}) {
  stubDialog(p);
  const t = tileFor(p, id);
  const r = t.getBoundingClientRect();
  p.pointer(t, 'pointerdown', {clientX: r.left + 10, clientY: r.top + 10});
  p.pointer(t, 'pointermove', {clientX: to.x, clientY: to.y});
  if (release) p.pointer(t, 'pointerup', {clientX: to.x, clientY: to.y});
  return t;
}

describe('layout dialog', () => {
  test('the Layout button opens the dialog with the current arrangement and section names', () => {
    const p = page();
    assert.equal(p.$('lo').hidden, true);
    p.$('layoutBtn').click();
    assert.equal(p.$('lo').hidden, false);
    assert.deepEqual(dialogCols(p), DEFAULT);
    const names = [...p.$('loGrid').querySelectorAll('.loname')].map(n => n.textContent);
    assert.deepEqual(names, ['Driving', 'Tyres & car', 'Lap timing', 'Track map', 'Standings', 'Strategy']);
    assert.equal(p.doc.activeElement, tileFor(p, 'p-driving'), 'keyboard users start on the first section');
    assert.match(tileFor(p, 'p-map').getAttribute('aria-label'), /^Track map: column 2 of 3, position 2 of 2\./);
    assert.equal(p.$('loDefault').disabled, true, 'already the default');
  });
  test('dragging a section to another column shows where it lands, then moves it', () => {
    const p = page();
    p.$('layoutBtn').click();
    const t = dragTile(p, 'p-standings', {x: 10, y: 70}, {release: false}); // column 1, above the middle of its first tile
    assert.equal(t.classList.contains('dragging'), true);
    const ghost = p.doc.querySelector('.loghost');
    assert.equal(ghost.textContent, 'Standings');
    assert.equal(ghost.style.left, '10px');
    const col1 = p.$('loGrid').querySelector('.locol');
    assert.equal(col1.querySelector('.lodrop').nextElementSibling, tileFor(p, 'p-driving'), 'marker above Driving');
    assert.equal(p.doc.body.classList.contains('lodragging'), true);
    p.pointer(t, 'pointerup', {clientX: 10, clientY: 70});
    assert.deepEqual(dialogCols(p), [['p-standings', 'p-driving', 'p-tyres'], ['p-lap', 'p-map'], ['p-strategy']]);
    assert.equal(p.doc.querySelector('.loghost'), null);
    assert.equal(p.doc.querySelector('.lodrop'), null);
    assert.equal(p.doc.body.classList.contains('lodragging'), false);
    assert.equal(p.doc.activeElement, tileFor(p, 'p-standings'), 'focus follows the moved section');
    assert.deepEqual(dashboard(p), DEFAULT, 'nothing changes on the dashboard before Save');
    assert.equal(p.$('loDefault').disabled, false);
  });
  test('dropping below every section puts it last; dropping beside the columns uses the nearest one', () => {
    const p = page();
    p.$('layoutBtn').click();
    dragTile(p, 'p-driving', {x: 250, y: 390}); // column 2, below its tiles
    assert.deepEqual(dialogCols(p), [['p-tyres'], ['p-lap', 'p-map', 'p-driving'], ['p-standings', 'p-strategy']]);
    dragTile(p, 'p-lap', {x: 5000, y: 60}); // far right of the last column, at the top
    assert.deepEqual(dialogCols(p), [['p-tyres'], ['p-map', 'p-driving'], ['p-lap', 'p-standings', 'p-strategy']]);
    dragTile(p, 'p-tyres', {x: 190, y: 160}); // in the gap between columns 1 and 2, nearer column 1: back where it was
    assert.deepEqual(dialogCols(p), [['p-tyres'], ['p-map', 'p-driving'], ['p-lap', 'p-standings', 'p-strategy']]);
  });
  test('a press without moving is not a drag; a cancelled drag changes nothing', () => {
    const p = page();
    p.$('layoutBtn').click();
    stubDialog(p);
    const t = tileFor(p, 'p-map');
    p.pointer(t, 'pointerdown', {clientX: 210, clientY: 120});
    p.pointer(t, 'pointermove', {clientX: 212, clientY: 121});
    assert.equal(p.doc.querySelector('.loghost'), null, 'under the drag threshold');
    p.pointer(t, 'pointerup', {clientX: 212, clientY: 121});
    assert.deepEqual(dialogCols(p), DEFAULT);
    dragTile(p, 'p-map', {x: 10, y: 60}, {release: false});
    p.pointer(tileFor(p, 'p-map'), 'pointercancel');
    assert.deepEqual(dialogCols(p), DEFAULT);
    assert.equal(p.doc.querySelector('.loghost'), null);
    p.pointer(tileFor(p, 'p-map'), 'pointerdown', {clientX: 0, clientY: 0, button: 2});
    p.pointer(tileFor(p, 'p-map'), 'pointermove', {clientX: 300, clientY: 300});
    assert.equal(p.doc.querySelector('.loghost'), null, 'right button does not drag');
  });
  test('arrow keys move the focused section; moves off the edge are ignored', () => {
    const p = page();
    p.$('layoutBtn').click();
    const keyOn = (id, key) => p.key(tileFor(p, id), key);
    keyOn('p-driving', 'ArrowDown');
    assert.deepEqual(dialogCols(p)[0], ['p-tyres', 'p-driving']);
    assert.equal(p.doc.activeElement, tileFor(p, 'p-driving'));
    keyOn('p-driving', 'ArrowDown');
    keyOn('p-tyres', 'ArrowUp');
    keyOn('p-tyres', 'ArrowLeft');
    keyOn('p-strategy', 'ArrowRight');
    keyOn('p-strategy', 'Enter');
    assert.deepEqual(dialogCols(p), [['p-tyres', 'p-driving'], ['p-lap', 'p-map'], ['p-standings', 'p-strategy']], 'edges and other keys ignored');
    keyOn('p-driving', 'ArrowRight');
    assert.deepEqual(dialogCols(p), [['p-tyres'], ['p-lap', 'p-driving', 'p-map'], ['p-standings', 'p-strategy']], 'same height in the next column');
    keyOn('p-standings', 'ArrowLeft');
    assert.deepEqual(dialogCols(p)[1], ['p-standings', 'p-lap', 'p-driving', 'p-map']);
  });
  test('columns: add up to four, drop into an empty one, remove an empty one', () => {
    const p = page();
    p.$('layoutBtn').click();
    p.$('loAddCol').click();
    assert.deepEqual(dialogCols(p), [...DEFAULT, []]);
    const empty = p.$('loGrid').querySelectorAll('.locol')[3];
    assert.equal(empty.querySelector('.loempty').textContent, 'Drop a section here');
    assert.ok(empty.querySelector('.lorm'), 'an empty column can be removed');
    assert.equal(p.$('loGrid').querySelectorAll('.lorm').length, 1, 'columns with sections cannot');
    assert.equal(p.$('loAddCol').disabled, true, 'four is the most');
    p.$('loAddCol').click();
    assert.equal(dialogCols(p).length, 4);
    const t = dragTile(p, 'p-map', {x: 610, y: 100}, {release: false});
    const col4 = p.$('loGrid').querySelectorAll('.locol')[3];
    assert.equal(col4.querySelector('.lodrop').nextElementSibling, col4.querySelector('.loempty'), 'marker above the hint');
    p.pointer(t, 'pointerup', {clientX: 610, clientY: 100});
    assert.deepEqual(dialogCols(p)[3], ['p-map']);
    p.key(tileFor(p, 'p-lap'), 'ArrowRight');
    p.key(tileFor(p, 'p-lap'), 'ArrowRight');
    assert.deepEqual(dialogCols(p), [['p-driving', 'p-tyres'], [], ['p-standings', 'p-strategy'], ['p-lap', 'p-map']]);
    assert.equal(p.$('loAddCol').disabled, true);
    p.$('loGrid').querySelector('.lorm').click();
    assert.deepEqual(dialogCols(p), [['p-driving', 'p-tyres'], ['p-standings', 'p-strategy'], ['p-lap', 'p-map']]);
    assert.equal(p.$('loAddCol').disabled, false);
  });
  test('Save lays out the dashboard and remembers it; the sections are moved, not rebuilt', () => {
    const p = page();
    const map = p.$('p-map'), canvas = p.$('map');
    p.$('layoutBtn').click();
    p.$('loAddCol').click();
    dragTile(p, 'p-standings', {x: 610, y: 100});
    p.key(tileFor(p, 'p-strategy'), 'ArrowLeft');
    assert.equal(p.$('loAddCol').disabled, true, 'no 5th column');
    p.$('loSave').click();
    assert.equal(p.$('lo').hidden, true);
    assert.deepEqual(dashboard(p), [['p-driving', 'p-tyres'], ['p-strategy', 'p-lap', 'p-map'], ['p-standings']], 'the emptied third column is dropped');
    assert.deepEqual(mainKids(p), ['c1', 'split-x', 'c2', 'split-x', 'c3']);
    assert.equal(p.$('c2').querySelectorAll(':scope > .split[data-dir="y"]').length, 2, 'a divider between each pair of sections');
    assert.equal(p.$('p-map'), map, 'the same element');
    assert.equal(map.querySelector('#map'), canvas, 'with everything in it');
    assert.deepEqual(JSON.parse(p.w.localStorage.getItem(ARRANGE)), {cols: dashboard(p)});
  });
  test('Cancel, ✕, Escape and the backdrop close without changing anything', () => {
    const p = page();
    for (const close of [() => p.$('loCancel').click(), () => p.$('loClose').click(), () => p.key(p.doc, 'Escape'), () => p.pointer(p.$('lo'), 'pointerdown')]) {
      p.$('layoutBtn').click();
      p.key(tileFor(p, 'p-driving'), 'ArrowRight');
      close();
      assert.equal(p.$('lo').hidden, true);
      assert.deepEqual(dashboard(p), DEFAULT);
      assert.equal(p.w.localStorage.getItem(ARRANGE), null);
    }
    p.$('layoutBtn').click();
    assert.deepEqual(dialogCols(p), DEFAULT, 'reopening starts from the saved layout, not the abandoned edit');
    p.pointer(p.$('loGrid'), 'pointerdown');
    assert.equal(p.$('lo').hidden, false, 'a press inside the dialog does not close it');
    p.$('lo').hidden = true;
    p.key(p.doc, 'Escape');
    assert.equal(p.$('lo').hidden, true);
  });
  test('Default layout puts every section back', () => {
    const custom = {cols: [['p-strategy'], ['p-map', 'p-lap', 'p-driving'], ['p-tyres', 'p-standings']]};
    const p = page({storage: {[ARRANGE]: JSON.stringify(custom)}});
    p.$('layoutBtn').click();
    assert.deepEqual(dialogCols(p), custom.cols);
    p.$('loDefault').click();
    assert.deepEqual(dialogCols(p), DEFAULT);
    assert.equal(p.$('loDefault').disabled, true);
    p.$('loSave').click();
    assert.deepEqual(dashboard(p), DEFAULT);
    assert.equal(p.w.localStorage.getItem(ARRANGE), null, 'the default needs no saved copy');
  });
});

describe('saved layout', () => {
  test('a saved arrangement is laid out on load, with working dividers', () => {
    const custom = {cols: [['p-map', 'p-standings', 'p-lap'], ['p-driving', 'p-tyres', 'p-strategy']]};
    const p = page({storage: {[ARRANGE]: JSON.stringify(custom)}});
    assert.deepEqual(dashboard(p), custom.cols);
    assert.deepEqual(mainKids(p), ['c1', 'split-x', 'c2']);
    p.$('c1').getBoundingClientRect = () => ({width: 700, height: 900});
    p.$('c2').getBoundingClientRect = () => ({width: 500, height: 900});
    const split = splitBetween(p, 'c1');
    p.pointer(split, 'pointerdown', {clientX: 700});
    p.pointer(split, 'pointermove', {clientX: 650});
    p.pointer(split, 'pointerup');
    assert.deepEqual(saved(p), {c1: 650, c2: 550});
  });
  test('a broken or outdated saved arrangement still shows every section', () => {
    assert.deepEqual(dashboard(page({storage: {[ARRANGE]: '{oops'}})), DEFAULT);
    const old = page({storage: {[ARRANGE]: JSON.stringify({cols: [['p-map', 'p-gone'], ['p-lap']]})}});
    assert.deepEqual(dashboard(old), [['p-map'], ['p-lap', 'p-driving', 'p-tyres', 'p-standings', 'p-strategy']]);
  });
  test('a new arrangement starts from even sizes; saving the same one keeps them', () => {
    const p = page({storage: {[KEY]: JSON.stringify({c1: 500, 'p-driving': 300})}});
    p.$('layoutBtn').click();
    p.$('loSave').click();
    assert.equal(weight(p.$('c1')), 500, 'unchanged layout: sizes kept');
    assert.equal(weight(p.$('p-driving')), 300);
    p.$('layoutBtn').click();
    p.key(tileFor(p, 'p-driving'), 'ArrowDown');
    p.$('loSave').click();
    assert.equal(p.$('c1').style.flex, '');
    assert.equal(p.$('p-driving').style.flex, '');
    assert.equal(p.w.localStorage.getItem(KEY), null);
  });
  test('on a narrow screen the sections stack in the saved order', () => {
    const custom = {cols: [['p-standings', 'p-map'], ['p-driving', 'p-tyres', 'p-lap', 'p-strategy']]};
    const p = page({desktop: false, storage: {[ARRANGE]: JSON.stringify(custom), [KEY]: JSON.stringify({c1: 500})}});
    const order = [...p.doc.querySelectorAll('main .card')].map(el => el.id);
    assert.deepEqual(order, custom.cols.flat());
    assert.equal(p.$('c1').style.flex, '', 'no desktop sizes on a narrow screen');
  });
});

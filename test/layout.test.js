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
  for (const [id, [width, height]] of Object.entries(sizes)) p.$(id).getBoundingClientRect = () => ({width, height});
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
  test('Layout button resets everything', () => {
    const p = page({storage: {[KEY]: JSON.stringify({c1: 500})}});
    p.$('resetLayout').click();
    assert.equal(p.$('c1').style.flex, '');
    assert.equal(p.w.localStorage.getItem(KEY), null);
  });
});

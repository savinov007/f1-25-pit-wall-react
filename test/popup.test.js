// Floating rival popup (public/popup.js) in jsdom: default placement, drag, resize, clamping, persistence.
const {test, describe, afterEach} = require('node:test');
const assert = require('node:assert/strict');
const {loadPage} = require('./helpers');

const KEY = 'pitwall-popup-v1';
const pages = [];
afterEach(() => pages.splice(0).forEach(p => p.close()));
function page(opts) {
  const p = loadPage({width: 1600, height: 900, ...opts});
  pages.push(p);
  return p;
}
const box = p => p.doc.querySelector('.dmbox');
const rect = p => {
  const s = box(p).style;
  return {x: parseFloat(s.left), y: parseFloat(s.top), w: parseFloat(s.width), h: parseFloat(s.height)};
};
const saved = p => JSON.parse(p.w.localStorage.getItem(KEY));
const head = p => box(p).querySelector('.dmhead');

describe('placement', () => {
  test('defaults to a centred window sized to the screen', () => {
    // 56% x 72% of 1600 x 900 (capped at 980 x 700), centred
    assert.deepEqual(rect(page()), {x: 352, y: 126, w: 896, h: 648});
  });
  test('restores a saved position, kept inside the window and above the minimum size', () => {
    const p = page({storage: {[KEY]: JSON.stringify({w: 5000, h: 100, x: -50, y: 2000})}});
    assert.deepEqual(rect(p), {x: 6, y: 594, w: 1588, h: 300});
  });
  test('ignores broken saved data', () => {
    assert.deepEqual(rect(page({storage: {[KEY]: '{oops'}})), {x: 352, y: 126, w: 896, h: 648});
  });
  test('stays on screen when the window shrinks', () => {
    const p = page();
    p.w.innerWidth = 800;
    p.w.innerHeight = 500;
    p.w.dispatchEvent(new p.w.Event('resize'));
    const r = rect(p);
    assert.ok(r.x + r.w <= 800 - 6 && r.y + r.h <= 500 - 6, JSON.stringify(r));
  });
});

describe('moving and resizing', () => {
  test('drag the header to move, remembered', () => {
    const p = page();
    p.pointer(head(p), 'pointerdown', {clientX: 400, clientY: 150});
    assert.equal(p.doc.body.classList.contains('popup-drag'), true);
    p.pointer(head(p), 'pointermove', {clientX: 300, clientY: 250});
    p.pointer(head(p), 'pointerup');
    assert.deepEqual(rect(p), {x: 252, y: 226, w: 896, h: 648});
    assert.deepEqual(saved(p), {x: 252, y: 226, w: 896, h: 648});
    assert.equal(p.doc.body.classList.contains('popup-drag'), false);
  });
  test('pressing a header button does not start a drag', () => {
    const p = page();
    p.pointer(p.$('dmClose'), 'pointerdown', {clientX: 400, clientY: 150});
    p.pointer(head(p), 'pointermove', {clientX: 100, clientY: 100});
    assert.equal(rect(p).x, 352);
  });
  test('right edge, bottom edge and corner resize, with a minimum size', () => {
    const p = page();
    const handle = edge => box(p).querySelector(`.rz[data-edge="${edge}"]`);
    p.pointer(handle('r'), 'pointerdown', {clientX: 1248, clientY: 500});
    p.pointer(handle('r'), 'pointermove', {clientX: 1148, clientY: 900});
    p.pointer(handle('r'), 'pointerup');
    assert.deepEqual(rect(p), {x: 352, y: 126, w: 796, h: 648}, 'width only');
    p.pointer(handle('b'), 'pointerdown', {clientX: 0, clientY: 774});
    p.pointer(handle('b'), 'pointermove', {clientX: 999, clientY: 674});
    p.pointer(handle('b'), 'pointerup');
    assert.equal(rect(p).h, 548);
    p.pointer(handle('br'), 'pointerdown', {clientX: 1148, clientY: 674});
    p.pointer(handle('br'), 'pointermove', {clientX: 0, clientY: 0});
    p.pointer(handle('br'), 'pointercancel');
    assert.deepEqual({w: rect(p).w, h: rect(p).h}, {w: 380, h: 300});
  });
  test('double-click the header to reset', () => {
    const p = page({storage: {[KEY]: JSON.stringify({w: 400, h: 300, x: 10, y: 10})}});
    head(p).dispatchEvent(new p.w.MouseEvent('dblclick', {bubbles: true}));
    assert.deepEqual(rect(p), {x: 352, y: 126, w: 896, h: 648});
    assert.deepEqual(saved(p), {x: 352, y: 126, w: 896, h: 648});
  });
});

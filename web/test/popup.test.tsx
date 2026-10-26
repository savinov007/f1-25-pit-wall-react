// The floating rival popup: default placement, drag, resize, clamping, persistence. Ported from test/popup.test.js.
import {act} from '@testing-library/react';
import {describe, expect, test} from 'vitest';
import {boot, dashboardState, type Page} from './helpers';

const KEY = 'pitwall-popup-v1';
async function page(opts: Parameters<typeof boot>[0] = {}) {
  const p = await boot({width: 1600, height: 900, ...opts});
  p.push(dashboardState());
  p.click(p.$$('.srow')[1]);
  return p;
}
const box = (p: Page) => p.$('.dmbox')!;
const rect = (p: Page) => {
  const s = box(p).style;
  return {x: parseFloat(s.left), y: parseFloat(s.top), w: parseFloat(s.width), h: parseFloat(s.height)};
};
const saved = () => JSON.parse(localStorage.getItem(KEY)!);
const head = (p: Page) => p.$('.dmhead')!;

describe('placement', () => {
  test('defaults to a centred window sized to the screen', async () => {
    // 56% x 72% of 1600 x 900 (capped at 980 x 700), centred
    expect(rect(await page())).toEqual({x: 352, y: 126, w: 896, h: 648});
  });
  test('restores a saved position, kept inside the window and above the minimum size', async () => {
    const p = await page({storage: {[KEY]: JSON.stringify({w: 5000, h: 100, x: -50, y: 2000})}});
    expect(rect(p)).toEqual({x: 6, y: 594, w: 1588, h: 300});
  });
  test('ignores broken saved data', async () => {
    expect(rect(await page({storage: {[KEY]: '{oops'}}))).toEqual({x: 352, y: 126, w: 896, h: 648});
  });
  test('stays on screen when the window shrinks', async () => {
    const p = await page();
    act(() => {
      window.innerWidth = 800;
      window.innerHeight = 500;
      window.dispatchEvent(new Event('resize'));
    });
    const r = rect(p);
    expect(r.x + r.w <= 800 - 6 && r.y + r.h <= 500 - 6, JSON.stringify(r)).toBe(true);
  });
});

describe('moving and resizing', () => {
  test('drag the header to move, remembered', async () => {
    const p = await page();
    p.pointer(head(p), 'pointerdown', {clientX: 400, clientY: 150});
    expect(document.body.classList.contains('popup-drag')).toBe(true);
    p.pointer(head(p), 'pointermove', {clientX: 300, clientY: 250});
    p.pointer(head(p), 'pointerup');
    expect(rect(p)).toEqual({x: 252, y: 226, w: 896, h: 648});
    expect(saved()).toEqual({x: 252, y: 226, w: 896, h: 648});
    expect(document.body.classList.contains('popup-drag')).toBe(false);
  });
  test('pressing a header button does not start a drag', async () => {
    const p = await page();
    p.pointer(p.$('.dmhead .hbtn')!, 'pointerdown', {clientX: 400, clientY: 150});
    p.pointer(head(p), 'pointermove', {clientX: 100, clientY: 100});
    expect(rect(p).x).toBe(352);
  });
  test('right edge, bottom edge and corner resize, with a minimum size', async () => {
    const p = await page();
    const handle = (edge: string) => p.$(`.rz[data-edge="${edge}"]`)!;
    p.pointer(handle('r'), 'pointerdown', {clientX: 1248, clientY: 500});
    p.pointer(handle('r'), 'pointermove', {clientX: 1148, clientY: 900});
    p.pointer(handle('r'), 'pointerup');
    expect(rect(p), 'width only').toEqual({x: 352, y: 126, w: 796, h: 648});
    p.pointer(handle('b'), 'pointerdown', {clientX: 0, clientY: 774});
    p.pointer(handle('b'), 'pointermove', {clientX: 999, clientY: 674});
    p.pointer(handle('b'), 'pointerup');
    expect(rect(p).h).toBe(548);
    p.pointer(handle('br'), 'pointerdown', {clientX: 1148, clientY: 674});
    p.pointer(handle('br'), 'pointermove', {clientX: 0, clientY: 0});
    p.pointer(handle('br'), 'pointercancel');
    expect({w: rect(p).w, h: rect(p).h}).toEqual({w: 380, h: 300});
  });
  test('double-click the header to reset', async () => {
    const p = await page({storage: {[KEY]: JSON.stringify({w: 400, h: 300, x: 10, y: 10})}});
    p.pointer(head(p), 'dblclick');
    expect(rect(p)).toEqual({x: 352, y: 126, w: 896, h: 648});
    expect(saved()).toEqual({x: 352, y: 126, w: 896, h: 648});
  });
});

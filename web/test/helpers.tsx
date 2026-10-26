// Test harness: the whole page rendered in jsdom with a fake WebSocket, driven by server messages built from the
// server's own demo generator (as test/helpers.js does for the server tests).
import {createRequire} from 'node:module';
import {act, cleanup, render} from '@testing-library/react';
import type {DashboardState, Rival} from '@shared';
import {App} from '../src/App';
import {connect, disconnect} from '../src/net/connection';
import {useDashboard} from '../src/store/dashboard';
import {resetLayout} from '../src/store/layout';
import {resetUi} from '../src/store/ui';
import {resetBuffers} from '../src/telemetry/buffers';

const require = createRequire(import.meta.url);
const server = require('../../server.js') as {
  demoFrame: (t: number) => Omit<DashboardState, 'connected' | 'hasData' | 'pps' | 'setup' | 'recording'>;
  demoRivals: (t: number, lap: number) => Rival[]};
const {demoFrame} = server;
/** The demo field at time t on lap `lap`. */
export const demoRivals = server.demoRivals;
const {packPoints} = require('../../build/shared') as typeof import('@shared');

/** A full server message at t = 45 s of the demo (lap 2, mid-lap, flat out on a straight). */
export function dashboardState(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    connected: true,
    hasData: true,
    pps: 20,
    setup: {ips: [{name: 'en0', address: '192.168.8.131'}], udpPort: 20777, demo: false},
    recording: {available: true, active: false, seconds: 0, packets: 0, bytes: 0, lastFile: null, lastBytes: 0, lastPackets: 0},
    ...demoFrame(45000),
    ...overrides,
  };
}

/** A car's data as the server sends it for the popup ('detail') or a compare column. */
export const detailFor = (s: DashboardState, idx: number) => ({
  idx,
  telemetry: s.telemetry!,
  status: s.status!,
  damage: s.damage!,
  lap: s.lap!,
  motion: s.motion,
});

type Sample = {speed: number; thr: number; brk: number; gear: number; ers: number | null; mode: number | null; ld?: number | null};
/** A server history snapshot in its packed wire form, from readable sample objects. */
export function packHistory({trail, lt}: {trail: (Sample & {a: number})[]; lt: null | {[k: string]: unknown; cur: (Sample & {d: number})[]; last: (Sample & {d: number})[]; best: (Sample & {d: number})[] | 'last'}}) {
  return {
    trail: packPoints(trail, 'a'),
    lt: lt && {...lt, cur: packPoints(lt.cur, 'd'), last: packPoints(lt.last, 'd'), best: lt.best === 'last' ? 'last' : packPoints(lt.best, 'd')},
  } as never;
}

export class FakeWebSocket {
  static OPEN = 1;
  static sockets: FakeWebSocket[] = [];
  readyState = 1;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: {data: string}) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.sockets.push(this);
    queueMicrotask(() => this.onopen?.());
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

/** matchMedia that answers the desktop query, switchable during a test. */
export const media = {
  desktop: true,
  listeners: new Set<() => void>(),
  set(desktop: boolean) {
    media.desktop = desktop;
    act(() => media.listeners.forEach(fn => fn()));
  },
};
window.matchMedia = ((query: string) => ({
  get matches() {
    return query.includes('min-width: 1000px') ? media.desktop : false;
  },
  media: query,
  addEventListener: (_: string, fn: () => void) => media.listeners.add(fn),
  removeEventListener: (_: string, fn: () => void) => media.listeners.delete(fn),
})) as unknown as typeof window.matchMedia;
Element.prototype.setPointerCapture = () => {};
globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

interface BootOptions {
  storage?: Record<string, string>;
  desktop?: boolean;
  width?: number;
  height?: number;
}

/** Renders the page with fresh stores and a connected socket. */
export async function boot({storage = {}, desktop = true, width = 1600, height = 900}: BootOptions = {}) {
  cleanup();
  disconnect();
  localStorage.clear();
  for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
  Object.defineProperty(window, 'innerWidth', {value: width, configurable: true, writable: true});
  Object.defineProperty(window, 'innerHeight', {value: height, configurable: true, writable: true});
  media.desktop = desktop;
  FakeWebSocket.sockets = [];
  resetUi();
  resetLayout();
  resetBuffers();
  useDashboard.setState({state: null, link: 'connecting', bestLap: 0});
  const view = render(<App />);
  connect();
  await act(async () => {}); // socket opens
  const socket = () => FakeWebSocket.sockets[FakeWebSocket.sockets.length - 1];
  const $ = <E extends Element = HTMLElement>(sel: string) => document.querySelector<E>(sel);
  const $$ = <E extends Element = HTMLElement>(sel: string) => [...document.querySelectorAll<E>(sel)];
  return {
    ...view,
    $,
    $$,
    socket,
    /** Every message the page has sent on the current socket. */
    sent: () => socket().sent,
    /** Delivers a server message to the page. */
    push(state: DashboardState) {
      act(() => socket().onmessage!({data: JSON.stringify(state)}));
    },
    click(sel: string | Element) {
      const el = typeof sel === 'string' ? $(sel) : sel;
      if (!el) throw new Error(`nothing matches ${sel}`);
      act(() => (el as HTMLElement).click());
    },
    key(target: EventTarget, key: string) {
      act(() => {
        target.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true}));
      });
    },
    pointer(target: Element, type: string, init: MouseEventInit = {}) {
      act(() => {
        target.dispatchEvent(new MouseEvent(type, {bubbles: true, cancelable: true, ...init}));
      });
    },
  };
}
export type Page = Awaited<ReturnType<typeof boot>>;

/** Visible text with a space between elements (textContent runs adjacent elements together). */
export function text(el: Element | null): string {
  // React splits text into several adjacent text nodes, so spaces go between elements, not between text nodes
  let out = '';
  const walk = (n: Node) => {
    if (n.nodeType === 3) out += n.textContent;
    else {
      out += ' ';
      n.childNodes.forEach(walk);
      out += ' ';
    }
  };
  if (el) walk(el);
  return out.replace(/\s+/g, ' ').trim();
}

/** Canvas 2D context stand-in: every call (and property set) is logged. */
export function fakeContext() {
  const log: unknown[][] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      if (prop === 'createLinearGradient') return () => ({addColorStop() {}});
      return (...args: unknown[]) => {
        log.push([prop, ...args]);
      };
    },
    set(obj, prop, value) {
      log.push(['set', prop, value]);
      obj[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const labels = () => log.filter(c => c[0] === 'fillText').map(c => c[1] as string);
  return {ctx, log, labels};
}

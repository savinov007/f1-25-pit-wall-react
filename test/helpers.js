// Shared test helpers: the real-packet fixture, dashboard states, and a jsdom harness that loads the
// actual page (index.html + lib.js + app.js + layout.js + popup.js) with a fake WebSocket and canvas.
const fs = require('fs');
const path = require('path');
const {JSDOM} = require('jsdom');
const {demoFrame} = require('../server');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const FIXTURE = path.join(__dirname, 'fixtures', 'catalunya-f125.jsonl');

// Real F1 25 packets (Catalunya, 10 cars) cut from a session recording: [{t, buf}] in arrival order.
function fixturePackets() {
  const lines = fs.readFileSync(FIXTURE, 'utf8').split('\n').filter(Boolean).slice(1);
  return lines.map(l => {
    const [t, b64] = JSON.parse(l);
    return {t, buf: Buffer.from(b64, 'base64')};
  });
}

// A full dashboard state as the server would broadcast it, built from the demo generator.
function dashboardState(overrides = {}) {
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

// Canvas 2D context stand-in: every method is a no-op; calls are logged so tests can inspect drawing.
function fakeContext(log) {
  const target = {};
  return new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({addColorStop() {}});
      if (prop === 'measureText') return () => ({width: 0});
      return (...args) => { log.push([prop, ...args]); };
    },
    set(obj, prop, value) { obj[prop] = value; return true; },
  });
}

/**
 * Loads the dashboard page into jsdom. Returns helpers to push server messages and read what the page sent.
 * options: storage (localStorage seed), width/height (viewport), desktop (min-width: 1000px media query).
 */
function loadPage({storage = {}, width = 1600, height = 900, desktop = true} = {}) {
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8')
    .replace(/<script[^>]*><\/script>/g, '')
    .replace(/<link[^>]*fonts\.(googleapis|gstatic)[^>]*>/g, '');
  const dom = new JSDOM(html, {url: 'http://localhost:3000/', pretendToBeVisual: true, runScripts: 'outside-only'});
  const w = dom.window;
  const drawLog = [];
  const sockets = [];

  Object.defineProperty(w, 'innerWidth', {value: width, configurable: true, writable: true});
  Object.defineProperty(w, 'innerHeight', {value: height, configurable: true, writable: true});
  const mediaListeners = [];
  const media = {matches: desktop, addEventListener: (_, fn) => mediaListeners.push(fn), removeEventListener() {}};
  w.matchMedia = () => media;
  w.HTMLCanvasElement.prototype.getContext = function () {
    if (!this._ctx) this._ctx = fakeContext(drawLog);
    return this._ctx;
  };
  w.Element.prototype.setPointerCapture = function () {};
  w.PointerEvent = w.MouseEvent;
  for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.sent = [];
      sockets.push(this);
      setTimeout(() => this.onopen && this.onopen(), 0);
    }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() {
      this.readyState = 3;
      if (this.onclose) this.onclose();
    }
  }
  w.WebSocket = FakeWebSocket;

  for (const script of ['lib.js', 'app.js', 'layout.js', 'popup.js']) {
    w.eval(fs.readFileSync(path.join(PUBLIC, script), 'utf8'));
  }

  const $ = id => w.document.getElementById(id);
  const socket = () => sockets[sockets.length - 1];
  return {
    dom, w, doc: w.document, $, sockets, drawLog,
    socket,
    /** Delivers a server message to the page. */
    push(state) {
      socket().onmessage({data: JSON.stringify(state)});
    },
    /** Every message the page has sent on the current socket. */
    sent: () => socket().sent,
    /** Reads a top-level script variable or calls a function inside the page. */
    eval: code => w.eval(code),
    pointer(el, type, init = {}) {
      el.dispatchEvent(new w.MouseEvent(type, {bubbles: true, cancelable: true, ...init}));
    },
    key(el, key) {
      el.dispatchEvent(new w.KeyboardEvent('keydown', {key, bubbles: true, cancelable: true}));
    },
    setDesktop(value) {
      media.matches = value;
      mediaListeners.forEach(fn => fn({matches: value}));
    },
    tick: (ms = 0) => new Promise(r => setTimeout(r, ms)),
    close: () => w.close(),
  };
}

module.exports = {ROOT, PUBLIC, FIXTURE, fixturePackets, dashboardState, loadPage, fakeContext};

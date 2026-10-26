// The WebSocket to the dashboard server: messages in (state ~30x/s), and what the page wants out
// (which car the rival popup shows, which cars are compared, recording and replay commands).
import type {DashboardState} from '@shared';
import {useDashboard} from '../store/dashboard';
import {useUi} from '../store/ui';
import {buffers, clearRivalPedals, ingest} from '../telemetry/buffers';

const RETRY_MS = 1500;

let socket: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let unwatch: (() => void) | null = null;

/** Sends a message if the socket is open; otherwise it is dropped (the server is told everything again on reconnect). */
export function send(msg: object): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(msg));
  return true;
}

const sendSelect = () => send({select: useUi.getState().selected});
const sendCompare = () => {
  const {compareOpen, compare} = useUi.getState();
  send({compare: compareOpen ? compare : []});
};

function onMessage(e: MessageEvent<string>) {
  const state = JSON.parse(e.data) as DashboardState;
  const {selected, compareOpen} = useUi.getState();
  ingest(state, {selected, compareOpen}, performance.now());
  useDashboard.setState({state, bestLap: buffers.bestLap});
}

function open() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  socket = ws;
  ws.onopen = () => {
    useDashboard.setState({link: 'open'});
    sendSelect();
    sendCompare();
  };
  ws.onmessage = onMessage;
  ws.onclose = () => {
    if (socket !== ws) return; // closed by disconnect()
    useDashboard.setState({link: 'offline'});
    retry = setTimeout(open, RETRY_MS);
  };
}

/** Connects (and keeps reconnecting), and tells the server whenever the watched cars change. */
export function connect(): void {
  disconnect();
  unwatch = useUi.subscribe((ui, prev) => {
    if (ui.selected !== prev.selected) {
      if (ui.selected != null) clearRivalPedals();
      sendSelect();
    }
    if (ui.compareOpen !== prev.compareOpen || ui.compare !== prev.compare) sendCompare();
  });
  open();
}

export function disconnect(): void {
  if (retry) clearTimeout(retry);
  retry = null;
  unwatch?.();
  unwatch = null;
  const ws = socket;
  socket = null;
  ws?.close();
}

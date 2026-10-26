// Replay mode: a floating control popup (play/pause, seek, skip, speed, loop) that can be dragged by its header
// and collapsed. The server owns the player; this only sends {replay: {action, value}} messages.
import {useEffect, useRef, useState} from 'react';
import type {ReplayStatus} from '@shared';
import {trackPointer, useBodyClass} from '../../hooks/dom';
import {send} from '../../net/connection';
import {useServer} from '../../store/dashboard';
import {KEYS, readJson, write} from '../../storage';
import {REPLAY_SPEEDS, replayClock, speedLabel} from './format';

const SEEK_STEPS = 1000; // the scrubber's range
const SKIP_MS = 10000;

interface Pos {
  x: number;
  y: number;
}

const sendReplay = (action: string, value?: unknown) => send({replay: value === undefined ? {action} : {action, value}});

/** Where the popup goes, kept inside the window. */
function place(box: HTMLElement, x: number, y: number): Pos {
  return {
    x: Math.max(6, Math.min(x, innerWidth - box.offsetWidth - 6)),
    y: Math.max(6, Math.min(y, innerHeight - box.offsetHeight - 6)),
  };
}

function savedPos(): Pos | null {
  const p = readJson<Pos>(KEYS.replayPos);
  return p && typeof p.x === 'number' && typeof p.y === 'number' ? p : null;
}

function ReplayPopup({r}: {r: ReplayStatus}) {
  const [collapsed, setCollapsed] = useState(false);
  const [pos, setPos] = useState<Pos | null>(savedPos);
  /** The scrubber position while the user holds it (server updates are held meanwhile). */
  const [scrub, setScrub] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const seek = useRef<HTMLInputElement>(null);
  const duration = useRef(r.duration);
  duration.current = r.duration;

  // seek once the thumb is let go: the native change event (React's onChange fires on every move)
  useEffect(() => {
    const input = seek.current!;
    const onChange = () => {
      sendReplay('seek', Math.round((Number(input.value) / SEEK_STEPS) * duration.current));
      setScrub(null);
    };
    input.addEventListener('change', onChange);
    return () => input.removeEventListener('change', onChange);
  }, []);

  const live = r.duration ? Math.round((r.pos / r.duration) * SEEK_STEPS) : 0;
  const seekValue = scrub ?? live;

  const onHeadDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('button')) return;
    e.preventDefault();
    const el = box.current!;
    const start = el.getBoundingClientRect(),
      sx = e.clientX,
      sy = e.clientY;
    let moved: Pos | null = null;
    trackPointer(e, {
      bodyClass: 'popup-drag',
      onMove: ev => setPos((moved = place(el, start.left + ev.clientX - sx, start.top + ev.clientY - sy))),
      onEnd: () => moved && write(KEYS.replayPos, moved),
    });
  };

  return (
    <div
      ref={box}
      className={`rp${pos ? ' placed' : ''}${collapsed ? ' collapsed' : ''}`}
      style={pos ? {left: pos.x, top: pos.y, bottom: 'auto'} : undefined}
      role="group"
      aria-label="Replay controls"
    >
      <div className="rphead" onPointerDown={onHeadDown}>
        <span className="rptitle">
          <i />
          REPLAY{' '}
          <small className="rpfile" title={r.file}>
            {r.file}
          </small>
        </span>
        <button type="button" className="rpmin" title={collapsed ? 'Expand' : 'Collapse'} onClick={() => setCollapsed(c => !c)}>
          –
        </button>
      </div>
      <div className="rpbody">
        <div className="rpscrub">
          <span className="rppos">{replayClock(scrub == null ? r.pos : (scrub / SEEK_STEPS) * r.duration)}</span>
          <input
            ref={seek}
            type="range"
            min={0}
            max={SEEK_STEPS}
            step={1}
            value={seekValue}
            aria-label="Position"
            onChange={e => setScrub(Number(e.target.value))}
          />
          <span className="rpdur">{replayClock(r.duration)}</span>
        </div>
        <div className="rpbtns">
          <button type="button" title="Back to start" onClick={() => sendReplay('restart')}>
            ⏮
          </button>
          <button type="button" title="Back 10 s" onClick={() => sendReplay('skip', -SKIP_MS)}>
            ⏪ 10
          </button>
          <button type="button" className="big rpplay" title="Play / pause" onClick={() => sendReplay('toggle')}>
            {r.playing ? '⏸' : '▶'}
          </button>
          <button type="button" title="Forward 10 s" onClick={() => sendReplay('skip', SKIP_MS)}>
            10 ⏩
          </button>
          <button type="button" className={r.loop ? 'on' : ''} title="Loop the recording" onClick={() => sendReplay('loop', !r.loop)}>
            ⟳
          </button>
        </div>
        <div className="rpspeeds">
          {REPLAY_SPEEDS.map(x => (
            <button key={x} type="button" data-speed={x} className={x === r.speed ? 'on' : ''} onClick={() => sendReplay('speed', x)}>
              {speedLabel(x)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The replay controls, while the dashboard plays a recording. */
export function ReplayControls() {
  const r = useServer(s => s?.replay && {...s.replay});
  useBodyClass('replaying', !!r);
  return r ? <ReplayPopup r={r} /> : null;
}

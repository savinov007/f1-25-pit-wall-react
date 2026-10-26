// Shown until the game sends data: pick the telemetry format, then the settings to enter in the game.
// Never shown over a replay.
import {useServer} from '../../store/dashboard';
import {chooseFormat, setReplaysOpen, useUi, type Format} from '../../store/ui';

const FORMATS: [Format, string, string][] = [
  ['2026', 'F1 26', 'UDP Format 2026'],
  ['2025', 'F1 25', 'UDP Format 2025'],
];

export function WaitScreen() {
  const setup = useServer(s => (s && !s.hasData && s.setup && !s.replay ? s.setup : null));
  const format = useUi(s => s.format);
  if (!setup) return null;
  const [ip, ...others] = setup.ips;
  return (
    <div className="wait">
      <div className="waitbox">
        <div className="pulse" />
        <h1>Waiting for game…</h1>
        <p className="hint">Which telemetry format will the game send?</p>
        <div className={`fmtpick${format ? '' : ' need'}`}>
          {FORMATS.map(([value, name, sub]) => (
            <button key={value} type="button" data-format={value} className={format === value ? 'on' : ''} onClick={() => chooseFormat(value)}>
              <b>{name}</b>
              <small>{sub}</small>
            </button>
          ))}
        </div>
        {format && (
          <>
            <p className="hint sethint">
              In F1 25 open <b>Settings → Telemetry Settings</b> and enter:
            </p>
            <div className="setup">
              <div>
                <span>UDP Telemetry</span>
                <b>On</b>
              </div>
              <div>
                <span>UDP Broadcast Mode</span>
                <b>Off</b>
              </div>
              <div className="ipline">
                <span>UDP IP Address</span>
                <b className="waitip">{ip ? ip.address : 'no network found'}</b>
              </div>
              <div>
                <span>UDP Port</span>
                <b className="waitport">{setup.udpPort}</b>
              </div>
              <div>
                <span>UDP Send Rate</span>
                <b>20Hz</b>
              </div>
              <div>
                <span>UDP Format</span>
                <b className="waitformat">{format + (format === '2026' ? ' (F1 26)' : ' (F1 25)')}</b>
              </div>
            </div>
          </>
        )}
        <button type="button" className="waitreplay" onClick={() => setReplaysOpen(true)}>
          ▶ Watch a saved replay
        </button>
        <p className="alt waitalt">{others.length ? 'Other addresses: ' + others.map(i => `${i.address} (${i.name})`).join(', ') : ''}</p>
        <p className="alt">
          Game on this Mac? Use <b>127.0.0.1</b>. Then start a session — this screen closes when data arrives.
        </p>
      </div>
    </div>
  );
}

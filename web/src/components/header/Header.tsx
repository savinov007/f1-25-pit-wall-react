// Top bar: brand, session chips (replay, session, track, format, weather, temperatures), the record / replays /
// compare / layout buttons and the connection status.
import {WEATHER, sessionLabel} from '@shared';
import {getServerState, useDashboard, useServer} from '../../store/dashboard';
import {openCompare, setLayoutOpen, setReplaysOpen} from '../../store/ui';
import {RecordButton} from './RecordButton';
import {replayClock, speedLabel} from '../replay/format';

function SessionChips() {
  const c = useServer(s => {
    const se = s?.session;
    const r = s?.replay;
    return {
      replay: r ? `${r.finished ? 'ENDED' : r.playing ? speedLabel(r.speed) : 'PAUSED'} · ${replayClock(r.pos)} / ${replayClock(r.duration)}` : null,
      paused: !!r && !r.playing,
      label: sessionLabel(se, s?.lap?.m_currentLapNum),
      track: se?.track,
      f26: !!se && se.packetFormat >= 2026,
      weather: se ? WEATHER[se.weather] || '—' : '—',
      trackTemp: se?.trackTemp,
      airTemp: se?.airTemp,
    };
  });
  return (
    <div className="session">
      {c.replay && (
        <span className={`chip replaychip${c.paused ? ' paused' : ''}`} title="Playing back a recording, not live game data">
          <i />
          <b>REPLAY</b>
          <span className="replayinfo">{c.replay}</span>
        </span>
      )}
      {c.label && <span className="chip sess">{c.label}</span>}
      <span className="chip track">
        <span>{c.track ?? '—'}</span>
      </span>
      {c.f26 && (
        <span className="chip fmt" title="UDP format 2026 (F1 25: 2026 Season Pack)">
          F1 26
        </span>
      )}
      <span className="chip">
        <span className="weather">{c.weather}</span>
      </span>
      <span className="chip">
        TRACK <b className="tracktemp">{c.trackTemp ?? '–'}</b>°
      </span>
      <span className="chip">
        AIR <b className="airtemp">{c.airTemp ?? '–'}</b>°
      </span>
    </div>
  );
}

function ConnectionStatus() {
  const link = useDashboard(d => d.link);
  const s = useServer(s => s && {connected: s.connected, hasData: s.hasData, pps: s.pps, finished: s.replay?.finished, replay: !!s.replay});
  let dot = 'dot',
    text = 'Connecting…';
  if (link === 'offline') text = 'SERVER OFFLINE — RETRYING';
  else if (s) {
    dot = 'dot ' + (s.connected ? 'live' : 'idle');
    text = s.replay ? (s.finished ? 'REPLAY ENDED' : 'REPLAY') : s.connected ? 'LIVE' : s.hasData ? 'NO SIGNAL — PAUSED?' : 'WAITING FOR GAME';
  }
  return (
    <span className="status">
      <span className={dot} />
      <span className="conntext">{text}</span>
      <span className="pps">
        <b>{s && link !== 'offline' ? s.pps : 0}</b> pkt/s
      </span>
    </span>
  );
}

export function Header() {
  const replaying = useServer(s => !!s?.replay);
  return (
    <header>
      <div className="brand">
        <span className="stripes">
          <i />
          <i />
          <i />
        </span>
        <span className="wordmark">
          PIT<b>WALL</b>
        </span>
      </div>
      <SessionChips />
      <div className="conn">
        <RecordButton />
        {/* a replay tab can't open more replays */}
        {!replaying && (
          <button className="hbtn replaysbtn" title="Open a saved recording as a replay in a new tab" onClick={() => setReplaysOpen(true)}>
            ▶ Replays
          </button>
        )}
        <button className="hbtn accent comparebtn" title="Compare drivers side by side" onClick={() => openCompare(getServerState()?.rivals)}>
          ⇄ Compare
        </button>
        <button className="hbtn layoutbtn" title="Arrange the dashboard sections" onClick={() => setLayoutOpen(true)}>
          ⊞ Layout
        </button>
        <ConnectionStatus />
      </div>
    </header>
  );
}

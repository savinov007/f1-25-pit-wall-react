// Records the raw game packets to a file on the server; says where it was saved when it stops.
import {useEffect, useRef} from 'react';
import {fmtClock} from '@shared';
import {send} from '../../net/connection';
import {useServer} from '../../store/dashboard';
import {showToast} from '../../store/ui';

export function RecordButton() {
  const r = useServer(s => s?.recording && {...s.recording});
  const wasActive = useRef(false);

  // only the moment a recording stops matters, so this runs when `active` changes, not on every message
  useEffect(() => {
    if (!r) return;
    if (wasActive.current && !r.active && r.lastFile) {
      showToast(
        <>
          Saved <code>{r.lastFile}</code> · {((r.lastBytes || 0) / 1048576).toFixed(1)} MB · {(r.lastPackets || 0).toLocaleString()} packets
          <br />
          Replay: <code>npm run replay -- {r.lastFile}</code>
        </>
      );
    }
    wasActive.current = r.active;
  }, [r?.active]);

  return (
    <button
      className={`rec${r?.active ? ' on' : ''}`}
      disabled={!r?.available}
      title={!r || r.available ? 'Record raw game packets to a file' : 'Recording needs live game data (not available in demo mode)'}
      onClick={() => r && send({record: !r.active})}
    >
      <i />
      <span className="rectext">{r?.active ? `${fmtClock(r.seconds || 0)} · ${(r.packets || 0).toLocaleString()} pkts` : 'REC'}</span>
    </button>
  );
}

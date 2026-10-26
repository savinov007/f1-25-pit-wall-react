// Saved replays: the recordings on the server, newest first. Choosing one opens it as its own replay dashboard
// in a new tab (the server starts it on a free port).
import {useEffect, useState} from 'react';
import {fmtClock, fmtSize} from '@shared';
import type {RecordingInfo} from '@shared';
import {useEscape} from '../../hooks/dom';
import {setReplaysOpen, useUi} from '../../store/ui';

const LOADING_PAGE =
  '<title>Loading replay…</title><body style="background:#07080b;color:#ffb020;font:600 18px sans-serif;display:grid;place-items:center;height:100vh;margin:0">Loading replay…</body>';

const recordedWhen = (r: RecordingInfo) =>
  new Date(r.startedAt || r.modified).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'});

function ReplaysList() {
  const [list, setList] = useState<RecordingInfo[] | null>(null);
  const [note, setNote] = useState('Loading…');
  const close = () => setReplaysOpen(false);
  useEscape(close);

  useEffect(() => {
    let current = true;
    fetch('/api/replays')
      .then(res => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json() as Promise<RecordingInfo[]>;
      })
      .then(data => {
        if (!current) return;
        setList(data);
        setNote(data.length ? 'Opens in a new tab. Big recordings take a few seconds to load.' : 'No recordings yet. Press REC during a session to save one.');
      })
      .catch(() => current && setNote('Could not load the list of recordings.'));
    return () => {
      current = false;
    };
  }, []);

  async function open(file: string) {
    // open the tab right away, inside the click, so the popup blocker allows it; point it at the replay once ready
    const tab = window.open('', '_blank');
    tab?.document.write(LOADING_PAGE);
    setNote(`Loading ${file}…`);
    try {
      const res = await fetch('/api/replays', {method: 'POST', body: JSON.stringify({file})});
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.status);
      const url = `${location.protocol}//${location.hostname}:${data.port}/`;
      if (tab) tab.location.href = url;
      else window.open(url, '_blank');
      close();
    } catch (err) {
      tab?.close();
      setNote(`Could not open the replay: ${(err as Error).message}`);
    }
  }

  return (
    <div className="rlover" onClick={e => e.target === e.currentTarget && close()}>
      <div className="rlbox" role="dialog" aria-label="Saved replays">
        <div className="rlhead">
          <b>Saved replays</b>
          <button type="button" title="Close" aria-label="Close" onClick={close}>
            ✕
          </button>
        </div>
        <div className="rllist">
          {(list || []).map(r => (
            <button key={r.file} type="button" className="rlrow" onClick={() => open(r.file)}>
              <span className="rlwhen">{recordedWhen(r)}</span>
              <span className="rlmeta">
                {r.duration ? fmtClock(Math.round(r.duration / 1000)) : '–'} · {fmtSize(r.bytes)}
              </span>
              <span className="rlname">{r.file}</span>
              <span className="rlgo">OPEN ↗</span>
            </button>
          ))}
        </div>
        <p className="rlnote">{note}</p>
      </div>
    </div>
  );
}

export function ReplaysDialog() {
  const open = useUi(s => s.replaysOpen);
  return open ? <ReplaysList /> : null;
}

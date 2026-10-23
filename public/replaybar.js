// Replay mode: header badge, amber accent, and a floating, draggable control popup (play/pause, seek, skip,
// speed, loop). The server owns the player; this only sends {replay: {action, value}} messages.
const REPLAY_SPEEDS = [0.25, 0.5, 1, 2, 3, 5, 10];
const rpEl = document.getElementById('rp');
const rpKey = 'pitwall-replay-pos';
let rpScrubbing = false;

const rpSend = (action, value) => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({replay: {action, value}}));
};
const rpClock = ms => fmtClock(Math.floor(ms / 1000));
const speedLabel = x => `${x}×`;

document.getElementById('rpSpeeds').innerHTML = REPLAY_SPEEDS.map(x => `<button type="button" data-speed="${x}">${speedLabel(x)}</button>`).join('');
document.getElementById('rpSpeeds').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) rpSend('speed', Number(b.dataset.speed));
});
const rpOn = (id, fn) => { document.getElementById(id).onclick = fn; };
rpOn('rpPlay', () => rpSend('toggle'));
rpOn('rpRestart', () => rpSend('restart'));
rpOn('rpBack', () => rpSend('skip', -10000));
rpOn('rpFwd', () => rpSend('skip', 10000));
rpOn('rpLoop', () => rpSend('loop', !(latest && latest.replay && latest.replay.loop)));
rpOn('rpMin', () => rpEl.classList.toggle('collapsed'));

const seekEl = document.getElementById('rpSeek');
seekEl.addEventListener('input', () => {
  rpScrubbing = true;
  const r = latest && latest.replay;
  if (r) document.getElementById('rpPos').textContent = rpClock(seekEl.value / 1000 * r.duration);
});
seekEl.addEventListener('change', () => {
  rpScrubbing = false;
  const r = latest && latest.replay;
  if (r) rpSend('seek', Math.round(seekEl.value / 1000 * r.duration));
});

// drag by the header; the position is remembered
(() => {
  const head = document.getElementById('rpHead');
  const place = (x, y) => {
    const w = rpEl.offsetWidth, h = rpEl.offsetHeight;
    x = Math.max(6, Math.min(x, innerWidth - w - 6));
    y = Math.max(6, Math.min(y, innerHeight - h - 6));
    rpEl.classList.add('placed');
    rpEl.style.left = x + 'px';
    rpEl.style.top = y + 'px';
    rpEl.style.bottom = 'auto';
    return {x, y};
  };
  try {
    const saved = JSON.parse(localStorage.getItem(rpKey));
    if (saved) place(saved.x, saved.y);
  } catch (err) { /* default position */ }
  head.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    head.setPointerCapture(e.pointerId);
    const box = rpEl.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
    let pos = null;
    document.body.classList.add('popup-drag');
    const move = ev => { pos = place(box.left + ev.clientX - sx, box.top + ev.clientY - sy); };
    const up = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      head.removeEventListener('pointercancel', up);
      document.body.classList.remove('popup-drag');
      if (pos) try { localStorage.setItem(rpKey, JSON.stringify(pos)); } catch (err) { /* not persisted */ }
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
    head.addEventListener('pointercancel', up);
  });
})();

// called from render() with every server message
function renderReplay(s) {
  const r = s.replay;
  document.body.classList.toggle('replaying', !!r);
  document.getElementById('replayChip').hidden = rpEl.hidden = !r;
  document.getElementById('replaysBtn').hidden = !!r; // a replay tab can't open more replays
  if (!r) return;
  document.getElementById('replayChip').classList.toggle('paused', !r.playing);
  document.getElementById('replayInfo').textContent =
    `${r.finished ? 'ENDED' : r.playing ? speedLabel(r.speed) : 'PAUSED'} · ${rpClock(r.pos)} / ${rpClock(r.duration)}`;
  document.getElementById('rpFile').textContent = r.file;
  document.getElementById('rpFile').title = r.file;
  document.getElementById('rpPlay').textContent = r.playing ? '⏸' : '▶';
  document.getElementById('rpLoop').classList.toggle('on', r.loop);
  document.getElementById('rpDur').textContent = rpClock(r.duration);
  if (!rpScrubbing) {
    document.getElementById('rpPos').textContent = rpClock(r.pos);
    seekEl.value = r.duration ? Math.round(r.pos / r.duration * 1000) : 0;
  }
  rpEl.querySelectorAll('#rpSpeeds button').forEach(b => b.classList.toggle('on', Number(b.dataset.speed) === r.speed));
  $('connText').textContent = r.finished ? 'REPLAY ENDED' : 'REPLAY';
}

// --- Saved replays: list the recordings on the server, open the chosen one in a new tab ---
const rl = document.getElementById('rl');
const rlList = document.getElementById('rlList');
const rlNote = document.getElementById('rlNote');

function closeReplays() { rl.hidden = true; }
function recordingWhen(r) {
  return new Date(r.startedAt || r.modified).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'});
}
function renderReplayList(list) {
  rlList.innerHTML = list.length ? list.map(r => `
    <button type="button" class="rlrow" data-file="${esc(r.file)}">
      <span class="rlwhen">${esc(recordingWhen(r))}</span>
      <span class="rlmeta">${r.duration ? fmtClock(Math.round(r.duration / 1000)) : '–'} · ${fmtSize(r.bytes)}</span>
      <span class="rlname">${esc(r.file)}</span>
      <span class="rlgo">OPEN ↗</span>
    </button>`).join('') : '';
  rlNote.textContent = list.length ? 'Opens in a new tab. Big recordings take a few seconds to load.' : 'No recordings yet. Press REC during a session to save one.';
}
async function openReplays() {
  rl.hidden = false;
  rlList.innerHTML = '';
  rlNote.textContent = 'Loading…';
  try {
    const res = await fetch('/api/replays');
    if (!res.ok) throw new Error(res.status);
    renderReplayList(await res.json());
  } catch (err) {
    rlNote.textContent = 'Could not load the list of recordings.';
  }
}
async function openReplayTab(file) {
  // open the tab right away, inside the click, so the popup blocker allows it; point it at the replay once ready
  const tab = window.open('', '_blank');
  if (tab) tab.document.write('<title>Loading replay…</title><body style="background:#07080b;color:#ffb020;font:600 18px sans-serif;display:grid;place-items:center;height:100vh;margin:0">Loading replay…</body>');
  rlNote.textContent = `Loading ${file}…`;
  try {
    const res = await fetch('/api/replays', {method: 'POST', body: JSON.stringify({file})});
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.status);
    const url = `${location.protocol}//${location.hostname}:${data.port}/`;
    if (tab) tab.location.href = url;
    else window.open(url, '_blank');
    rlNote.textContent = tab ? 'Opened in a new tab.' : `Your browser blocked the new tab: ${url}`;
    closeReplays();
  } catch (err) {
    if (tab) tab.close();
    rlNote.textContent = `Could not open the replay: ${err.message}`;
  }
}
document.getElementById('replaysBtn').onclick = openReplays;
document.getElementById('rlClose').onclick = closeReplays;
rl.addEventListener('click', e => {
  if (e.target === rl) closeReplays();
  const row = e.target.closest('.rlrow');
  if (row) openReplayTab(row.dataset.file);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !rl.hidden) closeReplays(); });

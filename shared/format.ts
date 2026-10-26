// Text formatting for times, gaps and sizes. Pure functions, shared by the page, the server and the tests.

export const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);

/** m:ss.sss, or '–' for no time. */
export const fmtTime = (ms: number | null | undefined): string => {
  if (!ms) return '–';
  const m = Math.floor(ms / 60000),
    s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
};
export const fmtSector = (ms: number | null | undefined): string => (ms ? (ms / 1000).toFixed(3) : '–');
// the game sends huge deltas for cars still in the garage; anything over 10 minutes is meaningless
export const fmtGap = (ms: number, leader: boolean): string =>
  leader ? 'LEADER' : ms && ms < 600000 ? '+' + (ms / 1000).toFixed(3) : '–';
export const fmtClock = (sec: number): string => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

export const gapOk = (ms: number | null | undefined): boolean => ms != null && ms >= 0 && ms < 600000;
/** Gap to the leader in ms, or null when unknown (the game reports 0 for cars without timing yet). */
export const leaderGap = (r: {pos: number; gapLeader: number}): number | null =>
  r.pos === 1 ? 0 : r.gapLeader > 0 && r.gapLeader < 600000 ? r.gapLeader : null;

export const fmtLaps = (n: number | null | undefined): string =>
  n == null ? '–' : !isFinite(n) ? '∞' : n < 10 ? n.toFixed(1) : String(Math.round(n));
export const fmtS = (ms: number): string => (ms / 1000).toFixed(Math.abs(ms) >= 10000 ? 1 : 2);
export const fmtRate = (ms: number): string => (ms >= 0 ? '+' : '−') + fmtS(Math.abs(ms)) + 's';
/** A driver's name for tight spots: 12 characters, upper case. */
export const nameOf = (r: {name: string}): string => r.name.slice(0, 12).toUpperCase();

/** File size for the replay list. */
export const fmtSize = (bytes: number): string =>
  bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(1)} GB` : `${Math.max(0.1, bytes / 1048576).toFixed(1)} MB`;

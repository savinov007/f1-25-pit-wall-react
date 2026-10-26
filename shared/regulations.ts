// Session names, lap tags and the UDP format 2026 (F1 25: 2026 Season Pack) rules: overtake mode instead of
// DRS, active aero, Boost as ERS mode 3.
import {ERS_MODES} from './constants';
import {fmtClock} from './format';
import type {CarStatus, Session, Telemetry, Telemetry2, Zone} from './types';

type T2 = Partial<Telemetry2> | null | undefined;

/** ERS deploy mode label: mode 3 is "Overtake" in the 2025 format and "Boost" in 2026. */
export const ersModeName = (mode: number | null | undefined, format?: number | null): string =>
  mode === 3 && (format ?? 0) >= 2026 ? 'Boost' : ERS_MODES[mode as number] || '';

/** [start, end] lap fractions -> [startM, endM] distance ranges; a zone that wraps past the line splits in two. */
export function zoneRanges(zones: Zone[] | null | undefined, trackLength: number | null | undefined): Zone[] {
  if (!trackLength) return [];
  const out: Zone[] = [];
  for (const [a, b] of zones || []) {
    if (a === b) continue;
    if (b > a) out.push([a * trackLength, b * trackLength]);
    else out.push([a * trackLength, trackLength], [0, b * trackLength]);
  }
  return out;
}

/**
 * Is the car using overtake mode? In real F1 26 data the available/active flags are 1 for every car for the
 * whole race (they only say the mode is enabled), so "using it" also needs the activation distance to have
 * run out and the car to be deploying in Boost (ERS mode 3).
 */
export const overtakeOn = (t2: T2, status: Pick<CarStatus, 'm_ersDeployMode'> | null | undefined): boolean =>
  !!(t2 && t2.m_2026Regulations && t2.m_overtakeActive && !t2.m_overtakeActivationDistance && status && status.m_ersDeployMode === 3);

/** Race sessions: 15 Race, 16 Race 2, 17 Race 3. */
export const RACE_SESSIONS = [15, 16, 17];
/**
 * Does the car have overtake mode to use right now? The game sets the flags for every car in every session, so
 * availability only counts in race sessions, with the activation countdown done.
 */
export const overtakeReady = (t2: T2, sessionType: number | null | undefined): boolean =>
  !!(t2 && t2.m_2026Regulations && t2.m_overtakeAvailable && !t2.m_overtakeActivationDistance && RACE_SESSIONS.includes(sessionType as number));

export interface BoostBadge {
  label: 'OVERTAKE' | 'DRS';
  on: boolean;
  avail: boolean;
  /** Metres until overtake mode becomes available (0 when it is, or there is no countdown). */
  wait: number;
}
/** DRS / overtake badge: 2026-regulation cars have overtake mode instead of DRS. */
export function boostBadge(t: Partial<Telemetry> | null | undefined, t2: T2, status?: Pick<CarStatus, 'm_ersDeployMode'> | null): BoostBadge {
  if (t2 && t2.m_2026Regulations) {
    const wait = t2.m_overtakeActivationDistance || 0;
    const on = overtakeOn(t2, status);
    return {label: 'OVERTAKE', on, avail: !on && !wait && !!(t2.m_overtakeAvailable || t2.m_overtakeActive), wait};
  }
  return {label: 'DRS', on: !!(t && t.m_drs), avail: false, wait: 0};
}

/**
 * Active aero wing mode of a 2026 car. The game never sets m_activeAeroAvailable in practice, but the mode
 * itself follows the car (straight on the straights), so it is shown whenever the car is a 2026 car.
 */
export const aeroLabel = (t2: T2): 'STRAIGHT' | 'CORNER' | null =>
  t2 && t2.m_2026Regulations ? (t2.m_activeAeroMode === 1 ? 'STRAIGHT' : 'CORNER') : null;

export interface LapTag {
  label: string;
  cls: string;
  title: string;
}
// lap type from the game's driver status (0 garage, 1 flying lap, 2 in lap, 3 out lap, 4 on track)
const LAP_TAGS: Record<number, LapTag> = {
  1: {label: 'FLY', cls: 'fly', title: 'Flying lap'},
  3: {label: 'OUT', cls: 'out', title: 'Out lap'},
};
/** Standings tag for the lap a car is on, or null. */
export const lapTag = (driverStatus: number | null | undefined): LapTag | null => LAP_TAGS[driverStatus as number] || null;

const SESSION_NAMES: Record<number, string> = {
  1: 'Practice 1', 2: 'Practice 2', 3: 'Practice 3', 4: 'Short Practice', 5: 'Qualifying 1', 6: 'Qualifying 2', 7: 'Qualifying 3',
  8: 'Short Qualifying', 9: 'One-Shot Qualifying', 10: 'Sprint Shootout 1', 11: 'Sprint Shootout 2', 12: 'Sprint Shootout 3',
  13: 'Short Sprint Shootout', 14: 'One-Shot Sprint Shootout', 15: 'Race', 16: 'Race 2', 17: 'Race 3', 18: 'Time Trial',
};
/** Header text for the session: its name, the lap (of the total in a race) and the time left when it is timed. */
export function sessionLabel(
  se: Pick<Session, 'sessionType'> & Partial<Pick<Session, 'totalLaps' | 'timeLeft'>> | null | undefined,
  lapNum: number | null | undefined
): string {
  if (!se || !SESSION_NAMES[se.sessionType]) return '';
  const race = RACE_SESSIONS.includes(se.sessionType);
  const parts = [SESSION_NAMES[se.sessionType]];
  const totalLaps = se.totalLaps || 0,
    timeLeft = se.timeLeft || 0;
  if (lapNum && lapNum > 0) parts.push(race && totalLaps > 0 ? `LAP ${lapNum}/${totalLaps}` : `LAP ${lapNum}`);
  if (!race && timeLeft > 0) parts.push(`${fmtClock(timeLeft)} LEFT`);
  return parts.join(' · ');
}

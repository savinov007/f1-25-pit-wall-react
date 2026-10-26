// Game constants and colour scales for the dashboard.
import type {CarDamage} from './types';

export const WEATHER = ['Clear', 'Light cloud', 'Overcast', 'Light rain', 'Heavy rain', 'Storm'];
export const ERS_MODES = ['None', 'Medium', 'Hotlap', 'Overtake'];
/** Full ERS store in joules. */
export const ERS_MAX = 4000000;

/** Visual tyre compound id -> [name, colour]. */
export const COMPOUNDS: Record<number, [string, string]> = {
  16: ['Soft', '#f92d29'],
  17: ['Medium', '#ebd25f'],
  18: ['Hard', '#ffffff'],
  7: ['Intermediate', '#3ac82b'],
  8: ['Wet', '#4491d2'],
};
export const compoundOf = (id: number | null | undefined): [string, string] =>
  (id != null && COMPOUNDS[id]) || ['–', '#888'];

export interface TyreCorner {
  n: 'FL' | 'FR' | 'RL' | 'RR';
  /** Index into the game's per-tyre arrays. */
  i: number;
  area: 'fl' | 'fr' | 'rl' | 'rr';
  side: 'l' | 'r';
  /** Where the tyre sits on the car diagram (viewBox 0 0 100 200). */
  x: number;
  y: number;
  w: number;
  h: number;
}
// Visual order FL FR RL RR; the game's arrays are RL RR FL FR.
export const TYRES: TyreCorner[] = [
  {n: 'FL', i: 2, area: 'fl', side: 'l', x: 5, y: 26, w: 19, h: 42},
  {n: 'FR', i: 3, area: 'fr', side: 'r', x: 76, y: 26, w: 19, h: 42},
  {n: 'RL', i: 0, area: 'rl', side: 'l', x: 2, y: 128, w: 23, h: 46},
  {n: 'RR', i: 1, area: 'rr', side: 'r', x: 75, y: 128, w: 23, h: 46},
];

type DamageKey = Exclude<keyof CarDamage, 'm_tyresWear'>;
/** Car diagram part (CSS class) -> the damage value that colours it. */
export const CAR_PARTS: [string, DamageKey][] = [
  ['fwl', 'm_frontLeftWingDamage'],
  ['fwr', 'm_frontRightWingDamage'],
  ['rw', 'm_rearWingDamage'],
  ['floor', 'm_floorDamage'],
  ['dif', 'm_diffuserDamage'],
  ['spl', 'm_sidepodDamage'],
  ['spr', 'm_sidepodDamage'],
];
/** Damage tiles, in display order. */
export const DMG_KEYS: [DamageKey, string][] = [
  ['m_frontLeftWingDamage', 'FL wing'],
  ['m_frontRightWingDamage', 'FR wing'],
  ['m_rearWingDamage', 'Rear wing'],
  ['m_floorDamage', 'Floor'],
  ['m_diffuserDamage', 'Diffuser'],
  ['m_sidepodDamage', 'Sidepods'],
  ['m_gearBoxDamage', 'Gearbox'],
  ['m_engineDamage', 'Engine'],
];

// Colour scales. Temperature bands are approximate working windows for the game's surface temps.
export const tempColor = (t: number): string => (t < 80 ? '#3aa0ff' : t < 105 ? '#1fd166' : t < 115 ? '#ffb020' : '#ff2d1f');
export const wearColor = (w: number): string => (w < 25 ? '#1fd166' : w < 45 ? '#e6d84a' : w < 65 ? '#ffb020' : '#ff2d1f');
export const dmgLevel = (v: number): 0 | 1 | 2 | 3 => (v <= 0 ? 0 : v < 20 ? 1 : v < 50 ? 2 : 3);
export const DMG_COLORS = ['', 'rgba(255, 176, 32, .45)', 'rgba(255, 122, 26, .85)', '#ff2d1f'];

/** Colour per compare slot (the first driver is the reference). */
export const SLOT_COLORS = ['#ff2d1f', '#3aa0ff', '#ffb020', '#1fd166'];

import {fmtClock} from '@shared';

/** Playback speeds offered in the replay controls. */
export const REPLAY_SPEEDS = [0.25, 0.5, 1, 2, 3, 5, 10];
export const speedLabel = (x: number) => `${x}×`;
/** m:ss for a replay position in ms. */
export const replayClock = (ms: number) => fmtClock(Math.floor(ms / 1000));

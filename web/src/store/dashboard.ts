// What the server last told us, and the state of the connection to it.
// One message arrives ~30 times a second; components subscribe to the few fields they show (see useServer),
// so a message only re-renders what actually changed.
import {create} from 'zustand';
import {useShallow} from 'zustand/react/shallow';
import type {DashboardState} from '@shared';

export type Link = 'connecting' | 'open' | 'offline';

interface DashboardStore {
  /** The latest server message, or null before the first one. */
  state: DashboardState | null;
  link: Link;
  /** Fastest lap the player has set this session (the game only sends the last one). */
  bestLap: number;
}

export const useDashboard = create<DashboardStore>(() => ({state: null, link: 'connecting', bestLap: 0}));

/** Subscribes to part of the latest server message. Return a primitive, or an object of primitives. */
export function useServer<T>(select: (s: DashboardState | null) => T): T {
  return useDashboard(useShallow((d: DashboardStore) => select(d.state)));
}

export const getServerState = (): DashboardState | null => useDashboard.getState().state;

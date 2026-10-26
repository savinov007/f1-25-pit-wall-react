// localStorage that never throws: private windows and blocked storage just mean nothing is remembered.
// The keys are the ones the dashboard has always used, so settings saved by earlier versions still apply.
export const KEYS = {
  format: 'pitwall-format',
  lapMode: 'pitwall-lapmode',
  wearLimit: 'pitwall-wearlimit',
  compareWindow: 'pitwall-cmpwin',
  sizes: 'pitwall-layout-v1',
  arrangement: 'pitwall-arrangement-v1',
  popup: 'pitwall-popup-v1',
  replayPos: 'pitwall-replay-pos',
} as const;

export function readText(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** The stored JSON value, or null when missing or unreadable. */
export function readJson<T>(key: string): T | null {
  const text = readText(key);
  if (text == null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Stores a string (or JSON for anything else); null removes the key. */
export function write(key: string, value: unknown): void {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch {
    // storage unavailable: the setting just won't persist
  }
}

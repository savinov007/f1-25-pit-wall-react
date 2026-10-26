// Dashboard arrangement: which sections sit in which column, top to bottom ({cols: [[id, ...], ...]}).

export interface Arrangement {
  cols: string[][];
}
export const MAX_COLS = 4;

const copy = (a: Arrangement): Arrangement => ({cols: a.cols.map(c => [...c])});

/**
 * A saved arrangement checked against the sections the page has: every section exactly once (unknown ones and
 * repeats dropped, missing ones added to the last column), no empty columns, at most MAX_COLS. Unusable: the fallback.
 */
export function normalizeArrangement(saved: unknown, ids: string[], fallback: Arrangement): Arrangement {
  const cols0 = saved && typeof saved === 'object' ? (saved as {cols?: unknown}).cols : null;
  if (!Array.isArray(cols0)) return copy(fallback);
  const seen = new Set<string>();
  const keep = (id: unknown): id is string => {
    if (typeof id !== 'string' || !ids.includes(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  };
  const cols = cols0
    .filter(Array.isArray)
    .map((c: unknown[]) => c.filter(keep))
    .filter(c => c.length)
    .slice(0, MAX_COLS);
  if (!cols.length) return copy(fallback);
  const placed = new Set(([] as string[]).concat(...cols));
  cols[cols.length - 1].push(...ids.filter(id => !placed.has(id)));
  return {cols};
}

/**
 * The arrangement with section `id` moved to column `col` at `index`, counted without the moved section.
 * Empty columns are kept: while editing, an empty column is a place to drop a section.
 */
export function moveSection(arr: Arrangement, id: string, col: number, index: number): Arrangement {
  const cols = arr.cols.map(c => c.filter(x => x !== id));
  if (!cols[col]) return copy(arr);
  cols[col].splice(Math.max(0, Math.min(index, cols[col].length)), 0, id);
  return {cols};
}

export const sameArrangement = (a: Arrangement, b: Arrangement): boolean => JSON.stringify(a) === JSON.stringify(b);

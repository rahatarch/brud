/**
 * The one shape in which a caller's capabilities reach a participant.
 *
 * A caller record is created once and passed by reference to every giver that
 * is shown the caller. A plain `Set` cannot be that shape: freezing a Set does
 * not stop `add`, `delete` or `clear`, and `Set.prototype.add.call(set, x)`
 * works on any Set. A giver could then grant any caller it can see
 * capabilities the kernel never granted. This view holds a private copy,
 * offers only the read side of a Set, and has no mutator to reach.
 */

/**
 * Creates a read-only view of a set of capability tokens.
 *
 * It satisfies `ReadonlySet<string>`: `has`, `size`, `forEach`, `keys`,
 * `values`, `entries` and iteration. Iteration order is sorted, so it is the
 * same for the same capabilities. `toJSON` returns the sorted array, so any
 * JSON boundary carries the capabilities instead of losing them.
 *
 * @param values - The capabilities. Copied; later changes to the source do not show.
 */
const VIEWS = new WeakSet<object>();

export function createCapabilitySet(values: Iterable<string>): ReadonlySet<string> {
  const sorted = Object.freeze([...new Set(values)].sort());
  const members = new Set(sorted);

  const view: ReadonlySet<string> & { toJSON(): readonly string[] } = {
    has: (value: string): boolean => members.has(value),
    get size(): number {
      return sorted.length;
    },
    forEach(callback: (value: string, key: string, set: ReadonlySet<string>) => void, thisArg?: unknown): void {
      for (const value of sorted) {
        callback.call(thisArg, value, value, view);
      }
    },
    keys: (): SetIterator<string> => sorted.values() as unknown as SetIterator<string>,
    values: (): SetIterator<string> => sorted.values() as unknown as SetIterator<string>,
    entries: (): SetIterator<[string, string]> =>
      sorted.map((value): [string, string] => [value, value]).values() as unknown as SetIterator<[string, string]>,
    [Symbol.iterator]: (): SetIterator<string> => sorted.values() as unknown as SetIterator<string>,
    toJSON: (): readonly string[] => sorted,
  } as unknown as ReadonlySet<string> & { toJSON(): readonly string[] };

  VIEWS.add(view);

  return Object.freeze(view);
}

/** Reports whether a value is a capability view made by {@link createCapabilitySet}. */
export function isCapabilitySet(value: unknown): value is ReadonlySet<string> {
  return typeof value === 'object' && value !== null && VIEWS.has(value);
}

/**
 * Copies a value for a boundary that carries only plain JSON, replacing every
 * capability view in it with its sorted array. Everything else is left as it
 * is, so a boundary's own plain-value check still refuses what is not plain.
 *
 * @param value - The value to carry across.
 */
export function withPlainCapabilities(value: unknown, depth = 0): unknown {
  if (isCapabilitySet(value)) {
    return [...value];
  }

  if (depth >= 16 || typeof value !== 'object' || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => withPlainCapabilities(item, depth + 1));
  }

  const prototype = Object.getPrototypeOf(value) as unknown;

  if (prototype !== Object.prototype && prototype !== null) {
    return value;
  }

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withPlainCapabilities(item, depth + 1)]));
}

/** The capability view of a caller that holds none. */
export const NO_CAPABILITIES: ReadonlySet<string> = createCapabilitySet([]);

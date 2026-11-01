/**
 * What a `Stop` or an `FeMergeNode` tells its parent: the library reads these from the parent's React children; a Svelte component sees no
 * children, so the child registers a getter for its props and the parent reads all of them when it builds its own props.
 *
 * The parent reads them in the order of the document. A child that arrives late (an `{#if}` block turning on between two others) registers
 * last, so each child also renders an anchor (`<native-anchor>`, no native view) whose `ref` handle can say where it sits among its siblings
 * (`HostHandle.position`); the host hands it over when it builds the anchor, and the registry then reads in that order, and tells the parent
 * to read again when the order is not the one it read last.
 */
export type Placed = { position(): readonly number[] };

export type Member = {
  /** The anchor's `ref`: its handle, or null when it goes away. */
  place(handle: Placed | null): void;
  unregister(): void;
};
export type Registry<Item> = { register(getter: () => Item): Member; read(): Item[] };

type Entry<Item> = { getter: () => Item; handle: Placed | null };

const compare = (left: readonly number[], right: readonly number[]): number => {
  for (let level = 0; level < Math.min(left.length, right.length); level++) if (left[level] !== right[level]) return (left[level] as number) - (right[level] as number);
  return left.length - right.length;
};

export function createRegistry<Item>(changed: () => void): Registry<Item> {
  const entries: Entry<Item>[] = [];
  let lastRead: Entry<Item>[] = [];
  /** Registration order, with the entries that have a place sorted by it; one that has none yet (it has just arrived) stays behind them. */
  const ordered = (): Entry<Item>[] => {
    const placed = entries.filter((entry) => entry.handle);
    const positions = new Map(placed.map((entry) => [entry, (entry.handle as Placed).position()] as const));
    placed.sort((left, right) => compare(positions.get(left) as number[], positions.get(right) as number[]));
    return [...placed, ...entries.filter((entry) => !entry.handle)];
  };
  const reorder = () => {
    const next = ordered();
    if (next.length !== lastRead.length || next.some((entry, index) => entry !== lastRead[index])) changed();
  };
  return {
    register(getter) {
      const entry: Entry<Item> = { getter, handle: null };
      entries.push(entry);
      changed();
      return {
        place(handle) {
          entry.handle = handle;
          if (handle) reorder();
        },
        unregister() {
          const index = entries.indexOf(entry);
          if (index >= 0) entries.splice(index, 1);
          changed();
        },
      };
    },
    read() {
      lastRead = ordered();
      return lastRead.map((entry) => entry.getter());
    },
  };
}

export const stopsKey = Symbol("svg stops");
export const mergeNodesKey = Symbol("svg merge nodes");

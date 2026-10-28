/**
 * What a `Stop` or an `FeMergeNode` tells its parent: the library reads these from the parent's React children; a Svelte component sees no
 * children, so the child registers a getter for its props and the parent reads all of them when it builds its own props.
 */
export type Registry<Item> = { register(getter: () => Item): () => void; read(): Item[] };

export function createRegistry<Item>(changed: () => void): Registry<Item> {
  const getters: (() => Item)[] = [];
  return {
    register(getter) {
      getters.push(getter);
      changed();
      return () => {
        const index = getters.indexOf(getter);
        if (index >= 0) getters.splice(index, 1);
        changed();
      };
    },
    read: () => getters.map((getter) => getter()),
  };
}

export const stopsKey = Symbol("svg stops");
export const mergeNodesKey = Symbol("svg merge nodes");

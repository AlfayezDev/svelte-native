/**
 * A small deterministic generator (mulberry32) for the property tests: the same seed is the same sequence of numbers in [0, 1), so a failing seed is a page, a file or a set of
 * props that can be generated again.
 */
export function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const labContext = Symbol("native-lab");
export type LabContext = { message: string };
export type RowHandle = { draft: () => string; setDraft: (value: string) => void };

export class RuneCounter {
  value = $state(1);
  doubled = $derived(this.value * 2);
  increment() { this.value++; }
}

export function runeCounter() {
  let value = $state(1);
  return { get value() { return value; }, increment() { value++; } };
}

/** What the lab's screen pages (`/__dev/screens`) report back to the stress scenarios that open them. */
export const screenLab = $state({ appears: 0, disappears: 0, detents: 0 });

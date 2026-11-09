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

/**
 * What the lab's screen pages (`/__dev/screens`) report back to the stress scenarios that open them. `header` picks how much
 * the `header-8` screens put in their bar (`?hv=` of the lab URL, for attributing a transition's cost): `full` title, subtitle and
 * a bell (the default), `title` the title only, `plain` no header at all; `rows` draws the screens' rows like the app's cards: a border and `overflow: hidden` (the default: React Native then draws the border with Core Animation), a border without `overflow` (`?rv=image`: React Native draws an image per view, about 0.2 ms each and again whenever the view's traits change) or no border (`?rv=plain`).
 */
export const screenLab = $state<{ appears: number; disappears: number; detents: number; header: "full" | "title" | "plain"; rows: "clip" | "image" | "plain" }>({ appears: 0, disappears: 0, detents: 0, header: "full", rows: "clip" });

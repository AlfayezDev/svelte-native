/** A class devalue cannot carry on its own: the app's `transport` hook (src/hooks.ts) says how. */
export class Money {
  constructor(readonly cents: number) {}
}

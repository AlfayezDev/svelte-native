/**
 * The QA app counts its `console.error` calls for the harness, which reads no logs on iOS: the lab results and the boot report
 * carry the count (`jsErrors`), the way Android's harness counts `E ReactNativeJS` lines. Installed by the root layout, so the
 * count starts with the app's own modules; a failure of the host's init before that is a dead app, which the harness sees.
 */
let count = 0;
let installed = false;

export function installErrorCounter(): void {
  if (installed) return;
  installed = true;
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    count++;
    original(...args);
  };
}

export const jsErrorCount = (): number => count;

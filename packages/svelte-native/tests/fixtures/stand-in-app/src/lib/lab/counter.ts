let errors = 0;
/** Counts the errors the app logs, for the lab's boot report. */
export function installErrorCounter(): void {
  const log = console.error;
  console.error = (...args: unknown[]) => { errors++; log(...args); };
}
export const errorCount = (): number => errors;

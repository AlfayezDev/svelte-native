/**
 * Boot phase marks for the Fabric entry. Modules call `mark` when they finish loading; the host logs one
 * `[Svelte boot]` line at the first commit with the time each phase took. Time zero is the first statement of
 * `init.ts`, the entry's first import, so the line covers bundle evaluation and the first mount but not the
 * native start-up before the JavaScript thread (`Start proc` to `Running "main"` in logcat covers both).
 */
const now = (): number => {
  const native = (globalThis as { nativePerformanceNow?: () => number }).nativePerformanceNow;
  return native ? native() : Date.now();
};

const marks: [name: string, at: number][] = [];
let zero = now();

export function mark(name: string): void {
  marks.push([name, now()]);
}

/** Restarts the clock; a hot remount reports its own phases. */
export function resetMarks(): void {
  marks.length = 0;
  zero = now();
}

/** `init 12 · polyfills 3 · host 41 · … · total 238 ms`, each phase measured from the previous mark. */
export function bootSummary(): string {
  let previous = zero;
  const parts: string[] = [];
  for (const [name, at] of marks) {
    parts.push(`${name} ${Math.round(at - previous)}`);
    previous = at;
  }
  parts.push(`total ${Math.round(previous - zero)} ms`);
  return parts.join(" · ");
}

let booted = false;
const bootTasks: (() => void)[] = [];

/** Runs [task] once the first commit is out, off the way to the first frame; at once when that has happened already. */
export function whenBooted(task: () => void): void {
  if (booted) task();
  else bootTasks.push(task);
}

/** The host calls this after the first commit (from a timer, so that what the first screen started goes first). */
export function runBootTasks(): void {
  booted = true;
  for (const task of bootTasks.splice(0)) task();
}

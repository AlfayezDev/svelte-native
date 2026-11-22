export declare function mark(name: string): void;
/** Restarts the clock; a hot remount reports its own phases. */
export declare function resetMarks(): void;
/** `init 12 · polyfills 3 · host 41 · … · total 238 ms`, each phase measured from the previous mark. */
export declare function bootSummary(): string;
/** Runs [task] once the first commit is out, off the way to the first frame; at once when that has happened already. */
export declare function whenBooted(task: () => void): void;
/** The host calls this after the first commit (from a timer, so that what the first screen started goes first). */
export declare function runBootTasks(): void;

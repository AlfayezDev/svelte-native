/**
 * Which async-mode run this is (`SVELTE_NATIVE_TEST_ASYNC`, `async-mode-setup.ts`): `1`, `microtask` or `frames`, and anything else, `0` and `false` included, is no run. `asyncRun` is
 * whether the compiler is mocked to compile every file with async mode (`1` and `microtask`), so a test whose control compiles without it cannot run.
 */
export type AsyncRun = "1" | "microtask" | "frames";
const modes: readonly string[] = ["1", "microtask", "frames"];
const given = process.env.SVELTE_NATIVE_TEST_ASYNC?.trim();
export const asyncTestMode: AsyncRun | undefined = given !== undefined && modes.includes(given) ? (given as AsyncRun) : undefined;
export const asyncRun = asyncTestMode === "1" || asyncTestMode === "microtask";

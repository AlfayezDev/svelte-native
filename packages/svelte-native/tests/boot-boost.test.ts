import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { hostTools, kotlinHost } from "./support/native-host.ts";

/**
 * The rules of the boot boost (BootBoostCore.kt: the pin to the big cores, its release at the first mount, after the timeout, or when no
 * Activity came; the library preload and its failure paths), compiled for the host and run against a fake platform. `BootBoost.kt` only
 * gives these rules the platform (Handler, SoLoader, sched_setaffinity), so it is the part this test cannot see. Skipped when `kotlinc` or
 * `java` is not on the path.
 */
const engine = resolve(import.meta.dirname, "../native/svelte-core/android/src/main/java/expo/modules/svelteengine");
const sources = { core: resolve(engine, "BootBoostCore.kt"), host: resolve(import.meta.dirname, "native/BootBoostHost.kt") };
const tools = hostTools("kotlinc", "java");
const { run } = kotlinHost({ name: "boot-boost", sources: [sources.host, sources.core] });

const scenarios = [
  "screen",
  "headless",
  "late-mount",
  "alike-cores",
  "no-big-core-allowed",
  "release-before-begin",
  "release-twice",
  "preload",
  "preload-twice",
  "preload-alike-cores",
  "preload-loader-fails",
  "preload-library-fails",
];
const processes = ["main-process io.rasheed.app io.rasheed.app", "main-process io.rasheed.app:sync io.rasheed.app", "main-process null io.rasheed.app"];

const pinned = "set self c0 | info BootBoost: pinned to c0";
const released = "reopen c0 ff | info BootBoost: released | released";

test.skipIf(!tools)("the boot boost's rules", () => {
  const out = run([...scenarios, ...processes]);
  const by = Object.fromEntries(scenarios.map((name, i) => [name, out[i] ?? ""]));

  // A start for the screen: pinned, the Activity says so 180 ms later (logged, for the series that sets the headless timer), the first mount
  // releases, and the timers armed at the start find nothing left to do.
  expect(by.screen).toBe(`${pinned} | set tid7 ff | info BootBoost: activity created 180 ms after the pin | ${released}`);
  // A start with no Activity: the headless timer releases the pin (the caller's thread has its mask back since handOver), and the timeout after it does nothing.
  expect(by.headless).toBe(`${pinned} | set tid7 ff | info BootBoost: no activity after 500 ms, a start for something that is not on screen | ${released}`);
  // The Activity came but the first mount did not: the pin holds past the headless timer and goes at the timeout.
  expect(by["late-mount"]).toBe(`set tid7 ff | ${released}`);
  // Nothing is armed, pinned or released where there is nothing to pin: alike cores, a cpuset without the big cores, a release before any begin.
  expect(by["alike-cores"]).toBe("");
  expect(by["no-big-core-allowed"]).toBe("");
  expect(by["release-before-begin"]).toBe("");
  // The release is once: one reopen, one notification, whatever calls it and however late the timers fire.
  expect(by["release-twice"]).toBe("reopen c0 ff | released");
});

test.skipIf(!tools)("the library preload", () => {
  const out = run(scenarios.slice(7));
  const [preload, twice, alike, loaderFails, libraryFails] = out;
  // One thread for all of them, held to the big cores, loading in order (the linker lets one load at a time anyway): the main thread waits for the first two.
  expect(preload).toBe("init | thread svelte-boot-load | set self c0 | load a | load b | load c");
  expect(twice).toBe("init");
  expect(alike).toBe("init | thread svelte-boot-load | load a | load b | load c");
  // A loader that cannot start is logged and nothing else happens; a library that cannot load is logged and the next one loads.
  expect(loaderFails).toBe("init | warn BootBoost: could not initialize SoLoader ahead of React Native, no library preload (IOException)");
  expect(libraryFails).toBe("init | thread svelte-boot-load | set self c0 | load a | load b | warn BootBoost: could not preload b (UnsatisfiedLinkError) | load c");
});

test.skipIf(!tools)("only the process the screen lives in boosts", () => {
  const out = run(processes);
  // The process named after the package; a service process of the app (`:sync`); a name that cannot be read counts as the main one.
  expect(out).toEqual(["true", "false", "true"]);
});

// A worklet runs on the UI runtime, where Svelte does not exist. A variable Svelte compiles into reactive state is read through Svelte's runtime (`$.get(count)`), so a
// worklet that reads one captures `$`, the namespace of `svelte/internal/client`, and the UI runtime rejects every function of it as a remote function ("Tried to
// synchronously call a Remote Function. Called "anonymous""): the screen throws when it mounts. The showcase's animateable-text screen did, 9 Nov 2026. Outside runes mode
// a variable that the markup mutates is state, and `count.value = ...` in a handler is such a mutation; the transformer fails the build and says why.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

type Outcome = { filename: string; closures?: string[][]; error?: string };
const run = (cases: { filename: string; src: string }[]): Outcome[] => {
  const root = "/work/apps/example";
  const done = spawnSync("node", [join(import.meta.dirname, "worklet-transformer-probe.ts"), JSON.stringify(cases.map((one) => ({ ...one, root })))], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (done.status !== 0) throw new Error(`the transformer probe failed:\n${done.stderr.slice(-2000)}`);
  return JSON.parse(done.stdout.trim().split("\n").at(-1) as string) as Outcome[];
};

const script = `<script lang="ts">
  import { createSharedValue, withTiming } from "@rasheed/svelte-native/animation";
  const count = createSharedValue(0);
  const countText = () => { "worklet"; return { text: String(Math.round(count.value)) }; };
</script>`;
const markup = `<native-view data={countText} onpress={() => { count.value = withTiming(1000, { duration: 3000 }); }}></native-view>`;
const rune = `<script lang="ts">
  import { createSharedValue } from "@rasheed/svelte-native/animation";
  const shown = createSharedValue(0);
  let n = $state(1);
  const text = () => { "worklet"; return { text: String(shown.value + n) }; };
</script>
<native-view data={text} onpress={() => { n++; }}></native-view>`;

test("a worklet reads a shared value the markup mutates: outside runes mode that is reactive state, and the build says so instead of the device throwing at mount", () => {
  const [legacy] = run([{ filename: "/work/apps/example/src/routes/counter/+mobile.svelte", src: `${script}\n${markup}\n` }]);
  expect(legacy.closures).toBeUndefined();
  expect(legacy.error).toContain("+mobile.svelte");
  expect(legacy.error).toContain("`count`");
  expect(legacy.error).toContain("<svelte:options runes />");
});

test("in runes mode the same component keeps the shared value a plain constant: the worklet captures it and nothing of Svelte", () => {
  const [runes] = run([{ filename: "/work/apps/example/src/routes/counter/+mobile.svelte", src: `<svelte:options runes />\n${script}\n${markup}\n` }]);
  expect(runes.error).toBeUndefined();
  expect(runes.closures).toEqual([["count"]]);
});

test("a worklet in a component that never mutates the shared value from its markup is not state either way", () => {
  const [legacy] = run([{ filename: "/work/apps/example/src/routes/counter/+mobile.svelte", src: `${script}\n<native-view data={countText}></native-view>\n` }]);
  expect(legacy.error).toBeUndefined();
  expect(legacy.closures).toEqual([["count"]]);
});

test("a worklet that reads $state in a runes component is refused too, with the advice for runes mode", () => {
  const [state] = run([{ filename: "/work/apps/example/src/routes/counter/+mobile.svelte", src: `${rune}\n` }]);
  expect(state.closures).toBeUndefined();
  expect(state.error).toContain("`n`");
  expect(state.error).toContain("shared value");
  expect(state.error).not.toContain("<svelte:options runes />");
});

test("a gesture callback is workletized without the directive and may run on the JavaScript thread, so the build leaves it to the gestures' own check", () => {
  const src = `<svelte:options runes />
<script lang="ts">
  import { Gesture } from "@rasheed/svelte-native/gestures";
  let n = $state(1);
  const pan = Gesture.Pan().runOnJS(true).onUpdate((event) => { console.log(n, event.translationX); });
</script>
<native-view gesture={pan} onpress={() => { n++; }}></native-view>
`;
  const [gesture] = run([{ filename: "/work/apps/example/src/routes/drag/+mobile.svelte", src }]);
  expect(gesture.error).toBeUndefined();
  expect(gesture.closures?.[0]).toContain("n");
});

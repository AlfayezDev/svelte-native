// A worklet runs on the UI runtime, where Svelte does not exist. A variable Svelte compiles into reactive state is read through Svelte's runtime (`$.get(count)`), so a
// worklet that reads one captures `$`, the namespace of `svelte/internal/client`, and the UI runtime rejects every function of it as a remote function ("Tried to
// synchronously call a Remote Function. Called "anonymous""): the screen throws when it mounts. The showcase's animateable-text screen did, 9 Nov 2026. Outside runes mode
// a variable that the markup mutates is state, and `count.value = ...` in a handler is such a mutation; the transformer fails the build and says why.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

type Outcome = { filename: string; closures?: string[][]; error?: string };
type Case = { filename: string; src: string };

/**
 * Transforms a table of cases in one Node process (starting Node and loading Babel and the transformer is what a case costs) and gives each case's outcome by its name. The table of an
 * environment is run by the first test that reads it, and once.
 */
function batch<Name extends string>(cases: Record<Name, Case>, env: Record<string, string> = {}): () => Record<Name, Outcome> {
  let outcomes: Record<Name, Outcome> | undefined;
  return () => {
    if (!outcomes) {
      const names = Object.keys(cases) as Name[];
      const root = "/work/apps/example";
      const done = spawnSync("node", [join(import.meta.dirname, "fixtures/worklet-transformer-probe.ts"), JSON.stringify(names.map((name) => ({ ...cases[name], root })))], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, SVELTE_NATIVE_RUNES: "", ...env } });
      if (done.status !== 0) throw new Error(`the transformer probe failed:\n${done.stderr.slice(-2000)}`);
      const results = JSON.parse(done.stdout.trim().split("\n").at(-1) as string) as Outcome[];
      outcomes = Object.fromEntries(names.map((name, at) => [name, results[at]])) as Record<Name, Outcome>;
    }
    return outcomes;
  };
}

const script = `<script lang="ts">
  import { createSharedValue, withTiming } from "@alfayez/svelte-native";
  const count = createSharedValue(0);
  const countText = () => { "worklet"; return { text: String(Math.round(count.value)) }; };
</script>`;
const markup = `<native-view data={countText} onpress={() => { count.value = withTiming(1000, { duration: 3000 }); }}></native-view>`;
const rune = `<script lang="ts">
  import { createSharedValue } from "@alfayez/svelte-native";
  const shown = createSharedValue(0);
  let n = $state(1);
  const text = () => { "worklet"; return { text: String(shown.value + n) }; };
</script>
<native-view data={text} onpress={() => { n++; }}></native-view>`;

const page = "/work/apps/example/src/routes/counter/+mobile.svelte";
const component = `${script}\n${markup}\n`;
const asRunes = `<svelte:options runes />\n${component}`;

/** The app's default (runes mode; `SVELTE_NATIVE_RUNES` is empty). */
const byDefault = batch({
  optedOut: { filename: page, src: `<svelte:options runes={false} />\n${component}` },
  noOptOut: { filename: page, src: component },
  explicit: { filename: page, src: asRunes },
  library: { filename: "/work/apps/example/node_modules/some-svelte-lib/Counter.svelte", src: component },
  neverMutated: { filename: page, src: `<svelte:options runes={false} />\n${script}\n<native-view data={countText}></native-view>\n` },
  state: { filename: page, src: `${rune}\n` },
  gesture: {
    filename: "/work/apps/example/src/routes/drag/+mobile.svelte",
    src: `<svelte:options runes />
<script lang="ts">
  import { Gesture } from "@alfayez/svelte-native";
  let n = $state(1);
  const pan = Gesture.Pan().runOnJS(true).onUpdate((event) => { console.log(n, event.translationX); });
</script>
<native-view gesture={pan} onpress={() => { n++; }}></native-view>
`,
  },
});

/** The app turned runes off (`runes: false`, which reaches the transformer as `SVELTE_NATIVE_RUNES=0`). */
const inferred = batch({ noOptOut: { filename: page, src: component }, explicit: { filename: page, src: asRunes } }, { SVELTE_NATIVE_RUNES: "0" });

test("a component that opts out of runes mode, and mutates the shared value its worklet reads, is reactive state: the build says so instead of the device throwing at mount", () => {
  const { optedOut } = byDefault();
  expect(optedOut.closures).toBeUndefined();
  expect(optedOut.error).toContain("+mobile.svelte");
  expect(optedOut.error).toContain("`count`");
  expect(optedOut.error).toContain("<svelte:options runes />");
  expect(optedOut.error).toContain("runes={false}");
});

test("the same component without the opt-out is in runes mode, the default: the shared value stays a plain constant and the worklet captures nothing of Svelte", () => {
  const { noOptOut, explicit } = byDefault();
  for (const runes of [noOptOut, explicit]) {
    expect(runes.error).toBeUndefined();
    expect(runes.closures).toEqual([["count"]]);
  }
});

test("with the app's `runes: false` Svelte infers each file's mode again: the component with no rune in it is legacy, and the build refuses the worklet", () => {
  const { noOptOut, explicit } = inferred();
  expect(noOptOut.error).toContain("`count`");
  expect(noOptOut.error).toContain("`runes: false`");
  // A file that asks for runes mode keeps it.
  expect(explicit.error).toBeUndefined();
});

test("a Svelte library below node_modules keeps Svelte's own default, so a component with no rune in it is legacy there even though the app's components are not", () => {
  const { library, noOptOut } = byDefault();
  expect(library.error).toContain("`count`");
  expect(noOptOut.error).toBeUndefined();
});

test("a worklet in a component that never mutates the shared value from its markup is not state either way", () => {
  const { neverMutated } = byDefault();
  expect(neverMutated.error).toBeUndefined();
  expect(neverMutated.closures).toEqual([["count"]]);
});

test("a worklet that reads $state in a runes component is refused too, with the advice for runes mode", () => {
  const { state } = byDefault();
  expect(state.closures).toBeUndefined();
  expect(state.error).toContain("`n`");
  expect(state.error).toContain("shared value");
  expect(state.error).not.toContain("<svelte:options runes />");
});

test("a gesture callback is workletized without the directive and may run on the JavaScript thread, so the build leaves it to the gestures' own check", () => {
  const { gesture } = byDefault();
  expect(gesture.error).toBeUndefined();
  expect(gesture.closures?.[0]).toContain("n");
});

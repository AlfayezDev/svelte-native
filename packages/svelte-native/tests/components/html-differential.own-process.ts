import { expect, test } from "bun:test";
import { type FakeNode, all, flat, host, load, settle } from "../support/html-harness.ts";
import { createProject } from "../support/project.ts";
import { random } from "../support/random.ts";

/**
 * What the host builds when a page changes must be what it builds for the page as it ended up: a differential test. A random page (text, inline elements, `{#if}`, keyed and unkeyed
 * `{#each}`, `{#key}`, snippets, a component that passes its props down, `<svelte:element>`, views with classes that make them flex or block, inline elements that are `block`, `hidden`,
 * `inline-flex`, ...) is mounted, put through random changes of its state (a few settled, some not), and its tree is compared with the tree of a fresh mount of the final state. An element
 * that is made again as another component, a run of text that is kept, a container whose layout changes, would each show as a difference. `bind:this` variables are checked too: each holds
 * the handle of the element that is there now, or nothing when it is gone.
 *
 * It runs in a Bun process of its own (`pnpm test` runs it after the other files; the name keeps it out of `bun test`'s discovery): each seed
 * compiles and imports a new page, and in the shared process of the whole suite that grows slower with every file before it (state that
 * piles up on the global object: under `--isolate` it is not slower). On the OVH host it took about 30 s alone, about 110 s for 130 seeds
 * after 47 other files and 99 seeds after 95, and passed in 44 s after the same 95 files under `--isolate`.
 */

const INLINE_CLASSES = ["", "text-lg", "text-white", "block", "inline", "hidden", "inline-flex", "flex", "gap-2", "inline-block", "contents"];
const CONTAINER_CLASSES = ["", "flex", "flex-row gap-2", "block", "text-lg", "items-center", "text-sm", "hidden", "contents", "inline-flex"];
const TEXTS = ["", "x", " y ", "Hello world", "  "];
const TAGS = ["span", "b", "div", "em", "button"];
const ROWS = [[], [{ id: 1, label: "r1" }], [{ id: 1, label: "r1" }, { id: 2, label: "r2" }], [{ id: 3, label: "r3" }, { id: 1, label: "r1" }]];
const LISTS = [[], ["a"], ["a", "b"], ["b", "a", "c"], ["c"]];
type State = { a: string; b: boolean; m: boolean; c: string; d: string; e: string; t: string; list: string[]; rows: { id: number; label: string }[] };
const INITIAL: State = { a: "x", b: true, m: true, c: "", d: "", e: "", t: "span", list: ["a", "b"], rows: [{ id: 1, label: "r1" }, { id: 2, label: "r2" }] };

const WRAPPER = `<script>let { label = "", children, ...rest } = $props();</script><div {...rest}>{label}{@render children?.()}</div>`;

/** The source of a page, and the names it binds with `bind:this`. */
function generate(next: () => number): { source: string; bound: string[] } {
  const bound: string[] = [];
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  const chance = (p: number): boolean => next() < p;
  // An element that binds itself (once in the page, and not in a block that repeats it): `testID` says which, for the test.
  const binding = (repeated: boolean): string => {
    if (repeated || !chance(0.3)) return "";
    const name = `n${bound.length}`;
    bound.push(name);
    return ` testID="${name}" bind:this={refs.${name}}`;
  };
  const node = (depth: number, repeated = false): string => {
    const roll = next();
    if (depth > 2 || roll < 0.22) return pick(["plain ", " spaced ", "{st.a}", "x{st.a}y ", "tail"]);
    if (roll < 0.34) return `{#if st.b}${node(depth + 1, repeated)}${chance(0.5) ? node(depth + 1, repeated) : ""}{:else}${chance(0.5) ? node(depth + 1, repeated) : ""}{/if}`;
    if (roll < 0.42) return `{#if st.m}${node(depth + 1, repeated)}{/if}`;
    if (roll < 0.5) return `{#each st.list as it (it)}${pick(["<b>{it}</b> ", "{it} ", "<i class={st.c}>{it}</i>", "<span>{it}</span>"])}{/each}`;
    if (roll < 0.54) return "{#each st.list as it}{it},{/each}";
    if (roll < 0.64) return `<b class={st.c}${binding(repeated)}>${node(depth + 1, repeated)}</b>`;
    if (roll < 0.72) return `<span class={st.c}${binding(repeated)}>${node(depth + 1, repeated)}</span>`;
    if (roll < 0.76) return `<i>${node(depth + 1, repeated)}</i>`;
    if (roll < 0.8) return `<a href="https://x.dev/" class={st.c}>${node(depth + 1, repeated)}</a>`;
    if (roll < 0.84) return `<span class="hidden"${binding(repeated)}>hid</span>`;
    if (roll < 0.9) return `<div class={st.e}${binding(repeated)}>${node(depth + 1, repeated)}${chance(0.5) ? node(depth + 1, repeated) : ""}</div>`;
    if (roll < 0.92) return `<button class={st.e}>${node(depth + 1, repeated)}</button>`;
    if (roll < 0.94) return `{#key st.a}${node(depth + 1, true)}{/key}`;
    if (roll < 0.96) return `<svelte:element this={st.t} class={st.c}>${node(depth + 1, repeated)}</svelte:element>`;
    if (roll < 0.97) return "{@render snip(st.a)}";
    if (roll < 0.98) return `<W label={st.a} class={st.c}>${node(depth + 1, repeated)}</W>`;
    if (roll < 0.99) return "{#each st.rows as r (r.id)}<b class={st.c}>{r.label}</b> {/each}";
    return `<small>${node(depth + 1, repeated)}</small>`;
  };
  const children = Array.from({ length: 1 + Math.floor(next() * 4) }, () => node(0)).join(pick(["", " ", "\n"]));
  const source = `<script>
  import W from "./W.svelte";
  let st = $state({ ...globalThis.__init });
  let refs = $state({});
  globalThis.__api = {
    set: (key, value) => { if (key === "rowLabel") { if (st.rows[0]) st.rows[0].label = value; } else if (key === "reverse") st.rows.reverse(); else st[key] = value; },
    tags: () => Object.fromEntries(Object.entries(refs).map(([name, handle]) => [name, handle?.tag ?? null])),
  };
</script>
{#snippet snip(v)}<b class={st.c}>{v}</b> tail{/snippet}
<div class={st.d}>${children}</div>
<section class={st.d}>${node(1, true)} <b class={st.c}>z</b></section>
`;
  return { source, bound };
}

/** What a tree has that the platform draws: the components, the strings, the style (its keys in order: the order they were merged in is not the platform's), whether it presses and its role. The tags are not: a tree that was made again has others. */
const normal = (nodes: FakeNode[], depth = 0): string =>
  nodes
    .map((node) => `${"  ".repeat(depth)}${node.name}${node.name === "RCTRawText" ? ` ${JSON.stringify(node.props.text)}` : ""}${node.props.style ? ` ${JSON.stringify(Object.fromEntries(Object.entries(flat(node.props.style)).sort(([one], [other]) => one.localeCompare(other))))}` : ""}${node.props.onClick ? " click" : ""}${node.props.accessibilityRole ? ` role=${node.props.accessibilityRole}` : ""}\n${normal(node.children, depth + 1)}`)
    .join("");

/** The faults of the text of a tree (a span outside a text, a text in a text, a string outside a text): React Native's own rules. */
function textFaults(nodes: FakeNode[], inText = false): string[] {
  const faults: string[] = [];
  for (const node of nodes) {
    if (node.name === "RCTRawText" && !inText) faults.push("a string outside a text");
    if (node.name === "RCTVirtualText" && !inText) faults.push("a span outside a text");
    if (node.name === "RCTText" && inText) faults.push("a text in a text");
    faults.push(...textFaults(node.children, node.name === "RCTText" || node.name === "RCTVirtualText"));
  }
  return faults;
}

const DIFFERENTIAL_BUDGET_MS = 120_000;

test("a page that is changed is what a fresh page of the same state is: random pages, random changes, the host's tree compared, and the bind:this handles", async () => {
  const seeds = Number(process.env.SEEDS ?? 150);
  const failures: string[] = [];
  let surface = 3000;
  // Stops short of the test's timeout: a loop that ran past it would go on in the background and reset the shared host under the files after it.
  const deadline = Date.now() + DIFFERENTIAL_BUDGET_MS - 10_000;
  for (let seed = 1; seed <= seeds; seed++) {
    if (Date.now() > deadline) {
      failures.push(`stopped after ${seed - 1} of ${seeds} seeds: the run reached its ${DIFFERENTIAL_BUDGET_MS / 1000} s budget (a slow or loaded machine)`);
      break;
    }
    const next = random(seed);
    const { source, bound } = generate(next);
    let m: Awaited<ReturnType<typeof load>>;
    try {
      using project = createProject({ "W.svelte": WRAPPER, "Fixture.svelte": source }, "svelte-native-differential-");
      m = await load(project.path("Fixture.svelte"));
    } catch (error) {
      failures.push(`seed ${seed}: the page does not build: ${(error as Error).message.split("\n")[0]}\n${source}`);
      continue;
    }
    if (Date.now() > deadline) {
      failures.push(`stopped during seed ${seed} of ${seeds}: building its page reached the ${DIFFERENTIAL_BUDGET_MS / 1000} s budget (a slow or loaded machine)`);
      break;
    }
    const state: State = JSON.parse(JSON.stringify(INITIAL));
    const globals = globalThis as unknown as { __init: State; __api: { set(key: string, value: unknown): void; tags(): Record<string, number | null> } };
    globals.__init = JSON.parse(JSON.stringify(state));
    host.roots = {};
    const tag = ++surface;
    m.startSurface(tag, m.Fixture, {});
    await settle(m);
    const api = globals.__api;
    const steps: string[] = [];
    const count = 6 + Math.floor(next() * 6);
    for (let step = 0; step < count; step++) {
      const key = pick(next, ["a", "b", "m", "c", "d", "e", "list", "t", "rows", "rowLabel", "reverse"]);
      let value: unknown;
      if (key === "t") value = pick(next, TAGS);
      else if (key === "rows") value = JSON.parse(JSON.stringify(pick(next, ROWS)));
      else if (key === "rowLabel") value = `L${Math.floor(next() * 5)}`;
      else if (key === "reverse") value = null;
      else if (key === "a") value = pick(next, TEXTS);
      else if (key === "b" || key === "m") value = next() < 0.5;
      else if (key === "c") value = pick(next, INLINE_CLASSES);
      else if (key === "list") value = pick(next, LISTS);
      else value = pick(next, key === "d" ? CONTAINER_CLASSES : INLINE_CLASSES);
      if (key === "rowLabel") { if (state.rows[0]) state.rows[0].label = value as string; } else if (key === "reverse") state.rows.reverse(); else (state as unknown as Record<string, unknown>)[key] = value;
      steps.push(`${key}=${JSON.stringify(value)}`);
      api.set(key, value !== null && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : value);
      // Some changes are flushed one at a time, and some together.
      if (next() < 0.5) await settle(m);
    }
    await settle(m);
    const incremental = host.roots[tag] ?? [];
    const result = normal(incremental);
    const faults = textFaults(incremental);
    // Each variable of a `bind:this` holds the handle of the element that is there now: its tag is the node's, and a gone element's is nothing.
    const nodes = all(incremental);
    const tags = api.tags();
    const wrong = bound.filter((name) => (nodes.find((node) => node.props.testID === name)?.tag ?? null) !== (tags[name] ?? null));
    globals.__init = JSON.parse(JSON.stringify(state));
    const fresh = ++surface;
    m.startSurface(fresh, m.Fixture, {});
    await settle(m);
    const expected = normal(host.roots[fresh] ?? []);
    if (result !== expected) failures.push(`seed ${seed}: changes ${steps.join(" ")}\n--- source\n${source}\n--- changed\n${result}\n--- fresh\n${expected}`);
    else if (faults.length > 0) failures.push(`seed ${seed}: ${faults[0]} after ${steps.join(" ")}\n${source}`);
    else if (wrong.length > 0) failures.push(`seed ${seed}: bind:this of ${wrong.join(", ")} is not the element that is there, after ${steps.join(" ")}\n${source}\n${result}`);
    m.stopSurface(tag);
    m.stopSurface(fresh);
  }
  expect(failures.slice(0, 2)).toEqual([]);
}, DIFFERENTIAL_BUDGET_MS);

function pick<T>(next: () => number, items: readonly T[]): T {
  return items[Math.floor(next() * items.length)] as T;
}

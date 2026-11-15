import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { baseStubs, load, src } from "../support/bundle.ts";
import { type FakeNode, settle } from "../support/host.ts";
import { fakeHost } from "../support/fake-host.ts";

const host = fakeHost();
const byId = (rootTag: number, id: string): FakeNode | undefined => host.nodes(rootTag).find((node) => node.props.testID === id);

/** `{...probe(name)}` is the lab pages' spread: `ref`, `testID` and `collapsable` on a lowered primitive. */
test("a function-valued ref in a spread (and next to one) reaches the host, as a plain attribute does", async () => {
  const m = await load<{ startSurface(rootTag: number, App: unknown, props: Record<string, unknown>): unknown; tick(): Promise<void>; Fixture: unknown }>({
    entry: `import Fixture from ${JSON.stringify(resolve(import.meta.dirname, "fixtures/spread-fixture.svelte"))};
      import { startSurface } from ${JSON.stringify(src("fabric/host.ts"))};
      import { tick } from 'svelte';
      export { startSurface, tick, Fixture };`,
    // The primitives the fixture imports are lowered away to host tags.
    stubs: { ...baseStubs(), "@alfayez/svelte-native": "export const View = null, Text = null, ScrollView = null;" },
    converters: false,
    lower: {},
  });
  const handles: Record<string, unknown[]> = {};
  const probe = (name: string) => ({
    ref: (handle: unknown) => { handles[name] ??= []; handles[name].push(handle); },
    testID: `probe.${name}`,
    collapsable: false,
  });
  const explicit = (handle: unknown) => { handles.explicit ??= []; handles.explicit.push(handle); };
  m.startSurface(81, m.Fixture, { probe, explicit, clicked: () => {} });
  await settle(m);
  for (const name of ["spread", "scroll", "text"]) {
    expect(handles[name], name).toHaveLength(1);
    expect((handles[name]?.[0] as { tag: number } | undefined)?.tag, name).toBe(byId(81, `probe.${name}`)?.tag as number);
  }
  // The explicit `ref` after the spread wins over the spread's own for "mixed" and loses to it for "after": Svelte's spread order.
  expect(handles.mixed).toBeUndefined();
  expect(handles.after).toHaveLength(1);
  expect(handles.explicit).toHaveLength(1);
  expect((handles.explicit?.[0] as { tag: number } | undefined)?.tag).toBe(byId(81, "mixed")?.tag as number);
  // `collapsable` and `testID` from the spread are ordinary props; the ref function is not a native prop.
  expect(byId(81, "probe.spread")?.props.collapsable).toBe(false);
  expect("ref" in (byId(81, "probe.spread")?.props ?? {})).toBe(false);
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { FakeNode } from "../support/harness.ts";
import { loadOracle, type Oracle } from "./support/oracle.ts";
import { describeOurs, describeTheirs, hasPress, pressHostProps, settle, svgWorld, toNode, toReact, type Spec, type SvgLoaded } from "./support/harness.ts";
import type { Platform } from "../../support/rn-reference.ts";
import { cases, svgRoot } from "./support/cases.ts";
import { resolve } from "node:path";

// The harnesses are made in `beforeAll`, outside the per-test restore of `support/preload.ts`: the file puts the global object back when it is done.
const world = svgWorld();
const fixture = (name: string) => resolve(import.meta.dirname, "fixtures", name);

/**
 * Every element of react-native-svg against the library's own element class (SPEC.md, "react-native-svg"): the same props go to the Svelte
 * component and to the library's, and the Fabric nodes, view names and props that result are equal. The one difference is the Touchable
 * mixin's six responder flags (`support/harness.ts`).
 */
type App = { show(node: unknown): void };
const platforms: Platform[] = ["android", "ios"];
const flags = ["onStartShouldSetResponder", "onResponderTerminationRequest", "onResponderGrant", "onResponderMove", "onResponderRelease", "onResponderTerminate"];
const flagsGiven = (spec: Spec | string): string[] => (typeof spec === "string" ? [] : [...flags.filter((flag) => spec.props && flag in spec.props), ...(spec.children ?? []).flatMap(flagsGiven)]);
for (const platform of platforms) {
  describe(platform, () => {
    let loaded: SvgLoaded;
    let oracle: Oracle;
    let app: App;
    let roots: () => Record<number, FakeNode[]>;
    const rootTag = 100;
    // The harness installs the fake Fabric binding on `globalThis` and the host reads it when its module loads: one harness at a time.
    beforeAll(async () => {
      const harness = await world.harness(platform, { natives: { assets: { 7: { uri: "asset:/seven.png", width: 7, height: 7, scale: 1 } } } });
      oracle = await loadOracle(platform);
      loaded = await harness.load(fixture("svg-cases-fixture.svelte")) as SvgLoaded;
      app = loaded.startSurface(rootTag, loaded.Fixture, {}) as App;
      roots = harness.roots;
    }, 60_000);
    const warn = console.warn;

    for (const [name, spec] of Object.entries({ ...cases, ...svgRoot })) {
      test(name, async () => {
        console.warn = () => {};
        try {
          app.show(toNode(spec));
          await settle(loaded);
          const ours = (roots()[rootTag] ?? []).map((node) => describeOurs(node, hasPress(spec) ? pressHostProps : []));
          const theirs = describeTheirs([oracle.mount(toReact(oracle, spec)) as never], loaded, platform, flagsGiven(spec));
          expect(ours).toEqual(theirs);
          expect(ours.length).toBeGreaterThan(0);
        } finally {
          console.warn = warn;
        }
      });
    }
  });
}

afterAll(() => world.restore());

import { afterAll, beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { type FakeNode, all, flat, host, load, settle, textOf } from "../support/html-harness.ts";
import { type GlobalSnapshot, snapshotGlobals } from "../support/globals.ts";

/**
 * A text with no colour of its own is drawn in the system's text colour of the app's light or dark mode (`system-colors.ts`, `fabric/host.ts` `withInk`), under every colour the
 * app gives: its style, its class, the HTML elements around it, the text it is in. React Native draws it black in both modes. The harness is Android's: Material 3's on-surface.
 */
let world: GlobalSnapshot;
beforeAll(() => { world = snapshotGlobals(); });
afterAll(() => world.restore());

const LIGHT = "#1C1B1F";
const DARK = "#E6E1E5";
const probe = globalThis as unknown as { __ink: { setColored(value: boolean): void } };

test("a text or an input with no colour has the system's, one with a colour of its own keeps it, and the mode switches the default", async () => {
  const m = await load(resolve(import.meta.dirname, "fixtures/ink-fixture.svelte"));
  host.roots = {};
  m.startSurface(701, m.Fixture, {});
  await settle(m);
  const nodes = () => all(host.roots[701] ?? []);
  const byId = (id: string): FakeNode => {
    const node = nodes().find((candidate) => candidate.props.testID === id);
    if (!node) throw new Error(`no node ${id}`);
    return node;
  };
  const color = (node: FakeNode) => flat(node.props.style).color;
  const run = () => nodes().find((node) => node.name === "RCTText" && textOf(node) === "A bare run") as FakeNode;
  const colors = () => ({
    plain: color(byId("plain")), styled: color(byId("styled")), classed: color(byId("classed")), toggled: color(byId("toggled")),
    inherited: color(byId("inherited")), run: color(run()), field: color(byId("field")), fieldStyled: color(byId("field-styled")),
    component: color(byId("component-field")),
  });

  expect(colors()).toEqual({ plain: LIGHT, styled: "#ff0000", classed: "#ffffff", toggled: LIGHT, inherited: "#ffffff", run: LIGHT, field: LIGHT, fieldStyled: "#0000ff", component: LIGHT });
  // A span is a part of its paragraph and takes its colour from it: it is given none.
  expect(byId("span").name).toBe("RCTVirtualText");
  expect(color(byId("span"))).toBeUndefined();
  // A colour the text's style gets later wins, and one it loses gives the default back: `{ color: undefined }` is no colour, as React Native flattens a style.
  probe.__ink.setColored(true);
  await settle(m);
  expect(color(byId("toggled"))).toBe("#00ff00");

  m.__setColorScheme("dark");
  await settle(m);
  expect(colors()).toEqual({ plain: DARK, styled: "#ff0000", classed: "#ffffff", toggled: "#00ff00", inherited: "#ffffff", run: DARK, field: DARK, fieldStyled: "#0000ff", component: DARK });
  probe.__ink.setColored(false);
  await settle(m);
  expect(color(byId("toggled"))).toBe(DARK);

  m.__setColorScheme("light");
  await settle(m);
  expect(colors()).toEqual({ plain: LIGHT, styled: "#ff0000", classed: "#ffffff", toggled: LIGHT, inherited: "#ffffff", run: LIGHT, field: LIGHT, fieldStyled: "#0000ff", component: LIGHT });
  m.stopSurface(701);
});

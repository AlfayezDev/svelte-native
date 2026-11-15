import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { navigationWorld, pathsOf, withInsets } from "../navigation/support/world.ts";
import { importedNames, labApplication, standInBundle, standInWorld, storeApplication, trouble } from "../navigation/support/stand-in.ts";

/**
 * The stand-in app with and without its lab.
 *
 * A store build's Metro resolves everything in the lab's directories to a stub that throws when it is used (`stubSource` over `stubCoreSource`), and the shared code (the root
 * layout, the session, the sign-in page) may call the lab only behind `labEnabled`. These tests mount the app's real root layout, session and pages the way a build runs them
 * (`navigation/support/stand-in.ts`), so that a lab call that is not behind the flag fails the test instead of a phone.
 */
const world = navigationWorld();
const { texts, mountTree } = world;
const { mountStandIn } = standInWorld(world);
const probe = resolve(import.meta.dirname, "fixtures/lab-stub-probe.svelte");

test("the app with the lab off: the root layout, the session and the screens that offer the lab run without calling it", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string };
  const checks: [number, string, boolean, string][] = [
    [150, "/projects", false, "Your projects"],
    [151, "/acme/home", false, "Project home"],
    [152, "/sign-in", true, "Sign in"],
  ];
  for (const [surface, initial, signedOut, expected] of checks) {
    const app = await mountStandIn(surface, { variant: "production", applicationId: storeApplication, initial, signedOut });
    const shown = app.texts();
    expect([initial, trouble(shown, app.errors)]).toEqual([initial, []]);
    expect([initial, shown]).toEqual([initial, [expected]]);
    expect(app.errors).toEqual([]);
    expect(app.router.current.url.pathname.startsWith("/__dev")).toBe(false);
  }
  // The launch link of the lab reaches a build with no lab as it reaches any project that is not the visitor's: the list, and no call into the lab.
  launch.__initialURL = "standin://__dev";
  const linked = await mountStandIn(153, { variant: "production", applicationId: storeApplication, initial: "/sign-in" });
  for (let turn = 0; turn < 4; turn++) await linked.settled();
  expect(trouble(linked.texts(), linked.errors)).toEqual([]);
  expect(pathsOf(linked.router)).toEqual(["/projects"]);
});

test("the same harness sees a lab call that is not behind the flag: with the flag on and the lab stubbed, the call fails the app", async () => {
  withInsets(24);
  // The lab build's table (it has the lab) but the store build's stubs: every lab call is a call into a stub, which is what an unguarded call in a store build is.
  await expect(mountStandIn(154, { variant: "qa", applicationId: labApplication, initial: "/projects" })).rejects.toThrow(/installErrorCounter|not in this app/);
  // And a bundle that has the lab in the store app: the shell refuses it, says so, and calls nothing.
  const refused = await mountStandIn(155, { variant: "qa", applicationId: storeApplication, initial: "/projects" });
  expect(trouble(refused.texts(), refused.errors.filter((line) => !line.includes("[stand-in lab]")))).toEqual([]);
  expect(refused.errors.filter((line) => line.includes("[stand-in lab]"))).toEqual(["[stand-in lab] this bundle carries the development lab, which the store app does not run: the lab is off"]);
  expect(refused.texts()).toEqual(["Your projects"]);
  // A lab build's application id with a store-variant Metro: the bundle has no lab, so none of it runs although the id would allow it.
  const mismatched = await mountStandIn(156, { variant: "production", applicationId: labApplication, initial: "/projects" });
  expect(trouble(mismatched.texts(), mismatched.errors)).toEqual([]);
  expect(mismatched.texts()).toEqual(["Your projects"]);
});

test("the lab stub fails an unguarded read of a binding, a call and a component, and nothing that stays behind the flag", async () => {
  withInsets(24);
  // Each is one way the shared code can use the lab's directories without the flag; a store build's Metro answers every one with the stub's error.
  const unguarded = ["read", "call", "component"];
  for (const [index, mode] of unguarded.entries()) {
    await expect(mountTree(160 + index, { mode }, probe, standInBundle("production"))).rejects.toThrow("src/lib/lab/ is not in this app (APP_VARIANT=production)");
  }
  const behind = await mountTree(163, { mode: "off" }, probe, standInBundle("production"));
  expect(behind.texts()).toEqual(["behind the flag"]);
});

test("which bindings an importer reads from a module, for the stub that has to throw on them", () => {
  const from = "#lib/lab/faults.ts";
  const read = (source: string) => importedNames(source, from);
  expect(read(`import { installErrorCounter, lateFault as fault, type Shape, lateFaultMessage } from "${from}";`)).toEqual(["installErrorCounter", "lateFault", "lateFaultMessage"]);
  expect(read(`import {\n  a, // why\n  /* b */ c,\n} from '${from}'\nimport { z } from "./other.ts"`)).toEqual(["a", "c"]);
  expect(read(`import type { Shape } from "${from}"; import Thing from "${from}"; import * as all from "${from}"; import "${from}";`)).toEqual([]);
  expect(read(`import Thing, { b } from "${from}"; export { c } from "${from}";`)).toEqual(["b", "c"]);
  expect(read(`const later = import("${from}");`)).toEqual([]);
  expect(read(`import { a } from "${from}.other";`)).toEqual([]);
  expect(() => read(`import { a b } from "${from}";`)).toThrow("cannot read the binding");
});

import { describe, expect, test } from "bun:test";
import { productApplicationId, qaApplicationId, smokeApplicationId } from "../../src/lib/native/app-ids.ts";
import { labDecision } from "../../src/lib/native/lab-flag.ts";
import { OPERATOR_APP_ID } from "../../src/lib/server/native-apps.ts";
import { defaultPackage } from "../lib/paths.ts";
import { packageOf } from "../lib/variant.ts";

/**
 * What runs of the development lab follows the bundle: its route table says whether it carries the lab (`lab`, the variant Metro bundled),
 * and the application id only adds to that. The bundle's stubs follow `APP_VARIANT`, so a flag that followed the id alone would call a stub
 * that throws when the id and the variant disagree (a QA dev client with a product-variant Metro) and would show the lab to a product shell
 * that was sent an update made without `APP_VARIANT=production`.
 */
describe("what runs of the development lab", () => {
  const decide = (bundleLab: boolean, applicationId: string | null, dev = false) => labDecision({ bundleLab, applicationId, dev });
  test("the QA and smoke apps run it from a bundle that has it, in development or not", () => {
    for (const id of [qaApplicationId, smokeApplicationId]) {
      expect(decide(true, id)).toEqual({ enabled: true, refused: false });
      expect(decide(true, id, true)).toEqual({ enabled: true, refused: false });
    }
  });
  test("a bundle without the lab runs none of it, in whatever app and mode: no call reaches a stub", () => {
    for (const id of [qaApplicationId, smokeApplicationId, productApplicationId, "host.exp.exponent", null]) {
      for (const dev of [false, true]) expect(decide(false, id, dev)).toEqual({ enabled: false, refused: false });
    }
  });
  test("the product shell refuses the lab from a bundle that has it, and says so", () => {
    expect(decide(true, productApplicationId)).toEqual({ enabled: false, refused: true });
    expect(decide(true, productApplicationId, true)).toEqual({ enabled: false, refused: true });
  });
  test("a development run of some other app id (Expo Go, a dev client) has the lab when its bundle does; a release of one does not", () => {
    expect(decide(true, "host.exp.exponent", true).enabled).toBe(true);
    expect(decide(true, null, true).enabled).toBe(true);
    expect(decide(true, "host.exp.exponent").enabled).toBe(false);
    expect(decide(true, null).enabled).toBe(false);
  });
});

describe("the three application ids", () => {
  test("the registry of the operator app, the QA harness and the flag read the ones app.config.ts makes the apps with", () => {
    expect(OPERATOR_APP_ID).toBe(productApplicationId);
    expect(defaultPackage).toBe(qaApplicationId);
    expect(packageOf).toEqual({ qa: qaApplicationId, smoke: smokeApplicationId });
    expect(new Set([productApplicationId, qaApplicationId, smokeApplicationId]).size).toBe(3);
  });
});

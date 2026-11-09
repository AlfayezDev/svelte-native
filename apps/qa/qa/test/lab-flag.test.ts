import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { platformDir } from "../lib/paths.ts";
import { productApplicationId, qaApplicationId, smokeApplicationId } from "../../src/lib/native/app-ids.ts";
import { enforceLab } from "../../src/lib/native/lab-guard.ts";
import { labDecision } from "../../src/lib/native/lab-flag.ts";
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

describe("a build without the lab turns a link to it away", () => {
	const routerAt = (pathname: string) => {
		const calls: [string, unknown][] = [];
		return { calls, router: { current: { url: new URL(pathname, "https://app.test") }, goto: (href: string, options?: unknown) => void calls.push([href, options]) } };
	};
	test("a lab path goes to the home screen, with the stack reset, and only where the lab is off", () => {
		for (const path of ["/__dev", "/__dev/screens?mode=tabs", "/__dev/tree/home/detail/7"]) {
			const off = routerAt(path);
			enforceLab(off.router, false);
			expect(off.calls).toEqual([["/", { reset: true }]]);
			const on = routerAt(path);
			enforceLab(on.router, true);
			expect(on.calls).toEqual([]);
		}
	});
	test("any other path is left alone, and so is a path that only starts like the lab's", () => {
		for (const path of ["/", "/settings", "/__devices", "/x/__dev"]) {
			const off = routerAt(path);
			enforceLab(off.router, false);
			expect(off.calls).toEqual([]);
		}
	});
});

describe("the three application ids", () => {
	/** The ids `app.config.ts` makes a build of each variant with: Android's package and iOS's bundle identifier. */
	function configured(variant: "qa" | "smoke" | "production"): { android: string; ios: string } {
		const env: NodeJS.ProcessEnv = { ...process.env };
		delete env.APP_VARIANT;
		if (variant !== "qa") env.APP_VARIANT = variant;
		const run = spawnSync(process.execPath, ["-e", "import('./app.config.ts').then((m) => console.log(JSON.stringify({ android: m.default.android.package, ios: m.default.ios.bundleIdentifier })))"], { cwd: platformDir, env, encoding: "utf8" });
		if (run.status !== 0) throw new Error(`app.config.ts did not evaluate: ${run.stderr}`);
		return JSON.parse(run.stdout) as { android: string; ios: string };
	}
	test("the QA harness and the flag read the ones app.config.ts makes the apps with", () => {
		expect(configured("production")).toEqual({ android: productApplicationId, ios: productApplicationId });
		expect(configured("qa")).toEqual({ android: qaApplicationId, ios: qaApplicationId });
		expect(configured("smoke")).toEqual({ android: smokeApplicationId, ios: smokeApplicationId });
		expect(defaultPackage).toBe(qaApplicationId);
		expect(packageOf).toEqual({ qa: qaApplicationId, smoke: smokeApplicationId, production: productApplicationId });
		expect(new Set([productApplicationId, qaApplicationId, smokeApplicationId]).size).toBe(3);
	});
});

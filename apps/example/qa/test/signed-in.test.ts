import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { accountRects, exposedAccount, findNode, matches, maskRects } from "../lib/drive.ts";
import { compare, redactedFailure } from "../lib/parity.ts";
import { copy } from "../lib/copy.ts";
import { enterSignedIn } from "../lib/signin.ts";
import { splitPhases } from "../lib/phases.ts";
import { a11yMetrics, parityMetrics } from "../lib/suite-metrics.ts";
import { paintOver, redactedColor, type Image } from "../lib/png.ts";
import { useAccount } from "../lib/qa-account.ts";
import {
	cases,
	layoutVariants,
	matrix,
	notCovered,
	pinnedNames,
	selectorFor,
	variants,
	type ScreenCase,
} from "../lib/screens.ts";
import { gatesPath } from "../lib/paths.ts";
import { parseHierarchy } from "../lib/uia.ts";
import type { A11yFile, ParityFile } from "../lib/types.ts";
import type { GatesFile } from "../lib/gates.ts";

const address = "qa.person+tests@example.test";
const signedIn = cases.filter((screen) => screen.signedIn);
const gatesFile = JSON.parse(readFileSync(gatesPath, "utf8")) as GatesFile;

function node(attributes: { text?: string; desc?: string; bounds: string; cls?: string; id?: string }): string {
	return `<node index="0" text="${attributes.text ?? ""}" resource-id="${attributes.id ?? ""}" class="${attributes.cls ?? "android.widget.TextView"}" package="p" content-desc="${attributes.desc ?? ""}" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="${attributes.bounds}" />`;
}
const tree = (...nodes: string[]) => parseHierarchy(`<?xml version='1.0' ?><hierarchy rotation="0">${nodes.join("")}</hierarchy>`);

describe("the signed-in cases", () => {
	test("they are the app-* cases, each one a signed-in case that needs the backend and opens the workspaces", () => {
		expect(signedIn.length).toBeGreaterThan(10);
		expect(signedIn.map((screen) => screen.id).every((id) => id.startsWith("app-"))).toBe(true);
		expect(cases.filter((screen) => screen.id.startsWith("app-")).length).toBe(signedIn.length);
		for (const screen of signedIn) {
			expect(screen.needsBackend).toBe(true);
			expect(screen.network).toBe("normal");
			expect(screen.deepLink).toBe("rasheed-svelte:///workspaces");
			expect(screen.steps.length).toBeGreaterThan(0);
		}
		expect(new Set(cases.map((screen) => screen.id)).size).toBe(cases.length);
	});

	test("the signed-out phase has none of them and the phases keep the matrix order", () => {
		const phases = splitPhases(cases);
		expect(phases.signedIn.map((screen) => screen.id)).toEqual(signedIn.map((screen) => screen.id));
		expect(phases.signedOut.some((screen) => screen.signedIn)).toBe(false);
		expect(phases.signedOut.length + phases.signedIn.length).toBe(cases.length);
	});

	test("a screen that shows the account's address masks it, and a sheet or modal names the screen it covers", () => {
		const masksAddress = (screen: ScreenCase) => screen.masks.some((mask) => mask.account === "email");
		for (const id of ["app-workspaces", "app-settings-profile", "app-account-profile"])
			expect(masksAddress(cases.find((screen) => screen.id === id) as ScreenCase)).toBe(true);
		for (const screen of signedIn.filter((entry) => entry.layout === "modal" || entry.layout === "sheet"))
			expect(screen.hidden.length).toBeGreaterThan(0);
	});

	test("their labels are the catalog's words, in both languages, so a copy change reaches them", () => {
		const workspaces = cases.find((screen) => screen.id === "app-workspaces") as ScreenCase;
		expect(workspaces.title).toEqual(copy("onboarding.selectWorkspaceTitle"));
		expect(selectorFor(workspaces.anchor, "rtl").label).toBe("اختر مساحة العمل");
		expect(selectorFor(workspaces.anchor, "ltr").label).toBe("Choose a workspace");
		expect(() => copy("auth.nothingLikeThis" as never)).toThrow("no text for");
	});

	test("every signed-in route is accounted for: the one the phase cannot reach is listed with the reason", () => {
		expect(notCovered.map((entry) => entry.route)).toContain("/onboarding/profile");
		expect(notCovered.some((entry) => entry.route.includes("workspaces"))).toBe(false);
	});

	test("gates.json pins exactly these screens for the emulator, and no pin is for a screen that is gone", () => {
		expect(gatesFile.signedIn?.android).toEqual(signedIn.map((screen) => screen.id));
		const gateIds = gatesFile.gates.map((gate) => gate.id);
		expect(gateIds).toContain("parity.signedIn.missing");
		expect(gateIds).toContain("a11y.signedIn.missing");
		for (const id of ["parity.signedIn.missing", "a11y.signedIn.missing"])
			expect(gatesFile.gates.find((gate) => gate.id === id)?.bar).toEqual({ android: { max: 0 } });
	});
});

describe("selecting the node that shows the address", () => {
	const shown = tree(node({ text: address, bounds: "[60,300][700,360]" }), node({ text: "Sign out", bounds: "[60,500][700,560]" }));

	test("it matches the node whose text is the address, in any case, and nothing else", () => {
		useAccount(address);
		expect(findNode(shown, { account: "email" }, "ltr")?.bounds).toEqual({ x: 60, y: 300, width: 640, height: 60 });
		expect(matches(shown.nodes[1] as never, { account: "email" })).toBe(false);
		useAccount(address.toUpperCase());
		expect(findNode(shown, { account: "email" }, "ltr")).not.toBeNull();
	});

	test("with no account configured the selector matches nothing, so a mask built on it refuses instead of hiding nothing", () => {
		useAccount(null);
		expect(findNode(shown, { account: "email" }, "ltr")).toBeNull();
		const workspaces = cases.find((screen) => screen.id === "app-workspaces") as ScreenCase;
		expect(() => maskRects(shown, workspaces, "ltr")).toThrow("matches no node");
	});

	test("its mask is the node's rectangle, and the error that names it never quotes the address", () => {
		useAccount(address);
		const workspaces = cases.find((screen) => screen.id === "app-workspaces") as ScreenCase;
		expect(maskRects(shown, workspaces, "ltr")).toEqual([{ x: 60, y: 300, width: 640, height: 60 }]);
		useAccount(address);
		const none = tree(node({ text: "Sign out", bounds: "[60,500][700,560]" }));
		let message = "";
		try {
			maskRects(none, workspaces, "ltr");
		} catch (error) {
			message = error instanceof Error ? error.message : "";
		}
		expect(message).toContain("matches no node");
		expect(message).not.toContain("example.test");
	});

	test("under a modal the covered screen's address is not masked: only a node the tree a service walks lists counts", () => {
		useAccount(address);
		const workspaces = cases.find((screen) => screen.id === "app-workspaces") as ScreenCase;
		const plain = tree(node({ text: address, bounds: "[60,300][700,360]" }), node({ text: "Close", bounds: "[0,100][100,200]" }));
		const covered = tree(node({ text: "Close", bounds: "[0,100][100,200]" }));
		expect(() => maskRects(plain, workspaces, "ltr", covered)).toThrow("matches no node");
		expect(maskRects(plain, workspaces, "ltr", plain)).toEqual([{ x: 60, y: 300, width: 640, height: 60 }]);
		expect(maskRects(plain, workspaces, "ltr")).toEqual([{ x: 60, y: 300, width: 640, height: 60 }]);
	});

	test("a reference is only frozen when no node shows the address outside the masks", () => {
		useAccount(address);
		expect(exposedAccount(shown, [{ x: 58, y: 298, width: 644, height: 64 }])).toEqual([]);
		expect(exposedAccount(shown, [])).toHaveLength(1);
		expect(exposedAccount(shown, [{ x: 0, y: 0, width: 100, height: 100 }])).toHaveLength(1);
		const hidden = tree(node({ text: address, bounds: "[0,0][0,0]" }));
		expect(exposedAccount(hidden, [])).toEqual([]);
		useAccount(null);
		expect(exposedAccount(shown, [])).toEqual([]);
	});

	test("a view is selected by its resource id (the testID of a view) alone or with its label", () => {
		const sample = tree(node({ id: "device-card", bounds: "[0,0][10,10]" }), node({ text: "x", id: "other", bounds: "[0,20][10,30]" }));
		expect(findNode(sample, { resourceId: "device-card" }, "ltr")?.bounds.y).toBe(0);
		expect(findNode(sample, { resourceId: "other", label: "x" }, "ltr")?.bounds.y).toBe(20);
		expect(findNode(sample, { resourceId: "other", label: "y" }, "ltr")).toBeNull();
	});
});

describe("painting over what must not be stored", () => {
	test("the masked pixels become one flat color and the rest stays as it was", () => {
		const data = Buffer.alloc(8 * 4 * 4, 7);
		const picture: Image = { width: 8, height: 4, data };
		const painted = paintOver(picture, [{ x: 2, y: 1, width: 3, height: 2 }]);
		const at = (x: number, y: number) => [...painted.data.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 4)];
		expect(at(2, 1)).toEqual([...redactedColor]);
		expect(at(4, 2)).toEqual([...redactedColor]);
		expect(at(5, 2)).toEqual([7, 7, 7, 7]);
		expect(at(2, 0)).toEqual([7, 7, 7, 7]);
		expect(picture.data[(1 * 8 + 2) * 4]).toBe(7);
	});
});

describe("keeping a failed signed-in comparison", () => {
	const flat = (value: number): Image => {
		const data = Buffer.alloc(12 * 6 * 4, value);
		for (let pixel = 0; pixel < 12 * 6; pixel++) data[pixel * 4 + 3] = 255;
		return { width: 12, height: 6, data };
	};
	/** The screen with a lighter "address" at the rectangle, as it is drawn where the node has moved to. */
	function withAddressAt(rect: { x: number; y: number; width: number; height: number }): Image {
		const image = flat(40);
		for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) image.data.fill(250, (y * 12 + x) * 4, (y * 12 + x) * 4 + 3);
		return image;
	}
	const at = (image: Image, x: number, y: number) => [...image.data.subarray((y * 12 + x) * 4, (y * 12 + x) * 4 + 4)];
	const referenceMask = { x: 0, y: 0, width: 4, height: 2 };
	const moved = { x: 6, y: 3, width: 4, height: 2 };

	test("an address that moved out of the reference's masks is painted over in the picture and is no red shape in the diff", () => {
		const actual = withAddressAt(moved);
		const reference = flat(40);
		const failed = compare(reference, actual, [referenceMask]);
		expect(failed.verdict).toBe("fail");
		// the reference's masks alone would keep it: the pixels of the address are in the open, and the diff paints them red
		expect(at(paintOver(actual, [referenceMask]), 7, 3)).toEqual([250, 250, 250, 255]);
		expect(at(failed.diffImage as Image, 7, 3).slice(0, 3)).toEqual([255, 0, 0]);
		const kept = redactedFailure(reference, actual, [referenceMask], [moved]);
		expect(at(kept.actual, 7, 3)).toEqual([...redactedColor]);
		expect(at(kept.actual, 11, 5)).toEqual([40, 40, 40, 255]);
		expect(at(kept.diff, 7, 3).slice(0, 3)).not.toEqual([255, 0, 0]);
		// the reference's own masks are still painted
		expect(at(kept.actual, 1, 1)).toEqual([...redactedColor]);
	});

	test("the rectangles of every node that shows the address are taken from the tree, covered or not, and none without an account", () => {
		useAccount(address);
		const shown = tree(node({ text: `Signed in as ${address}`, bounds: "[60,300][700,360]" }), node({ desc: address.toUpperCase(), bounds: "[10,10][50,30]" }), node({ text: "Sign out", bounds: "[60,500][700,560]" }), node({ text: address, bounds: "[0,0][0,0]" }));
		expect(accountRects(shown)).toEqual([
			{ x: 60, y: 300, width: 640, height: 60 },
			{ x: 10, y: 10, width: 40, height: 20 },
		]);
		useAccount(null);
		expect(accountRects(shown)).toEqual([]);
		useAccount(undefined);
	});
});

describe("starting the phase", () => {
	const session = {} as never;

	test("an unreachable backend or a missing account is the phase's reason, not a throw", async () => {
		useAccount(address);
		const down = await enterSignedIn(session, { ok: false, detail: "https://dev.example answered 503" });
		expect(down).toEqual({ ok: false, reason: "needs the dev backend: https://dev.example answered 503" });
		useAccount(null);
		const unconfigured = await enterSignedIn(session, { ok: true, detail: "" });
		expect(unconfigured.ok).toBe(false);
		expect(unconfigured.ok ? "" : unconfigured.reason).toContain("RASHEED_QA_EMAIL");
		useAccount(undefined);
	});
});

describe("the gates over the pinned screens", () => {
	const ids = ["app-workspaces", "app-account-preferences"];
	const names = pinnedNames(ids, variants);

	test("a pinned screen is expected in every variant and in the layouts of the accessibility run", () => {
		expect(names).toHaveLength(ids.length * variants.length);
		expect(pinnedNames(ids, layoutVariants)).toHaveLength(ids.length * layoutVariants.length);
		expect(pinnedNames(["gone"], variants)).toHaveLength(variants.length);
		// A screen left out of the largest text is left out of the pinned names too.
		expect(pinnedNames(["app-account-devices"], variants)).toHaveLength(variants.length / 2);
		expect(pinnedNames(["app-account-devices"], layoutVariants)).toHaveLength(layoutVariants.length / 2);
		expect(matrix(signedIn, variants).length).toBe(signedIn.length * variants.length - 2 * (variants.length / 2));
	});

	const caseOf = (name: string, verdict: "pass" | "skipped") => ({ name, verdict, differingPixels: 0, maskedPixels: 100 });
	const parityFile = (compared: string[]) =>
		({ mode: "check", matrixSize: 40, screenPixels: 1000, notCovered: [], cases: compared.map((name) => caseOf(name, "pass")) }) as unknown as ParityFile;

	test("parity counts the pinned names the run did not compare", () => {
		expect(parityMetrics(parityFile(names), ids)["parity.signedIn.missing"]).toBe(0);
		expect(parityMetrics(parityFile(names.slice(2)), ids)["parity.signedIn.missing"]).toBe(2);
		expect(parityMetrics(parityFile(names), ids)["parity.signedIn.expected"]).toBe(names.length);
		expect(parityMetrics(parityFile(names))["parity.signedIn.missing"]).toBeUndefined();
	});

	test("a skipped case is not a comparison", () => {
		const skipped = { ...parityFile(names), cases: names.map((name) => caseOf(name, "skipped")) } as unknown as ParityFile;
		expect(parityMetrics(skipped, ids)["parity.signedIn.missing"]).toBe(names.length);
	});

	const screen = (name: string, error: string | null) => ({ name, error, interactive: 1, unreachable: 0, unlabeled: 0, notActionable: 0, orderViolations: 0, titleFirst: true, focusLeaks: 0, reachable: 1, labeled: 1, actionable: 1 });
	test("accessibility counts the pinned names that were not dumped", () => {
		const layoutNames = pinnedNames(ids, layoutVariants);
		const file = (entries: ReturnType<typeof screen>[]) => ({ matrixSize: 40, screens: entries }) as unknown as A11yFile;
		expect(a11yMetrics(file(layoutNames.map((name) => screen(name, null))), ids)["a11y.signedIn.missing"]).toBe(0);
		expect(a11yMetrics(file(layoutNames.map((name, index) => screen(name, index === 0 ? "boom" : null))), ids)["a11y.signedIn.missing"]).toBe(1);
		expect(a11yMetrics(file([]), ids)["a11y.signedIn.missing"]).toBe(layoutNames.length);
	});
});

import { readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
	compare,
	emptyManifest,
	maskedPct,
	maskRefusal,
	maxMaskedPct,
	readManifest,
	readReference,
	referenceMasks,
	statusBarMaskProblem,
	writeManifest,
	writeReference,
	type Manifest,
} from "../lib/parity.ts";
import type { GatesFile } from "../lib/gates.ts";
import { decodePng, type Image } from "../lib/png.ts";

function image(width: number, height: number, tint = 0): Image {
	const data = Buffer.alloc(width * height * 4, 255);
	for (let i = 0; i < width * height; i++) {
		data[i * 4] = (i * 5 + tint) & 0xff;
		data[i * 4 + 1] = (i * 3) & 0xff;
		data[i * 4 + 2] = (i ^ tint) & 0xff;
	}
	return { width, height, data };
}

const source = { commit: "abc1234", dirty: false };

describe("references on disk", () => {
	test("a reference round-trips and is checked against its checksum", async () => {
		const root = await mkdtemp(join(tmpdir(), "native-qa-parity-"));
		const picture = image(24, 16);
		const written = await writeReference("kind-a", "screen--light-ltr-normal", picture, root);
		expect(written.file).toBe("screen--light-ltr-normal.png");
		expect([written.width, written.height]).toEqual([24, 16]);
		const manifest: Manifest = emptyManifest("kind-a");
		manifest.references["screen--light-ltr-normal"] = {
			...written,
			masks: [{ name: "status bar", x: 0, y: 0, width: 24, height: 2 }],
			screen: "screen",
			route: "/x",
			state: "ready",
			theme: "light",
			direction: "ltr",
			fontScale: 1,
			updatedAt: "2026-10-26T00:00:00.000Z",
			source,
		};
		await writeManifest(manifest, root);
		const back = await readManifest("kind-a", root);
		const entry = back?.references["screen--light-ltr-normal"];
		if (!entry) throw new Error("manifest lost the entry");
		expect((await readReference("kind-a", entry, root)).data.equals(picture.data)).toBe(true);
		await writeFile(join(root, "kind-a", entry.file), Buffer.from("tampered"));
		let error: unknown;
		try {
			await readReference("kind-a", entry, root);
		} catch (caught) {
			error = caught;
		}
		expect(error instanceof Error && error.message.includes("checksum")).toBe(true);
		expect(await readManifest("kind-b", root)).toBeNull();
	});

	test("the manifest is written with its references sorted by name", async () => {
		const root = await mkdtemp(join(tmpdir(), "native-qa-parity-"));
		const manifest = emptyManifest("kind-a");
		const entry = {
			file: "x.png",
			sha256: "0",
			width: 1,
			height: 1,
			masks: [],
			screen: "s",
			route: "/",
			state: "ready" as const,
			theme: "light" as const,
			direction: "ltr" as const,
			fontScale: 1,
			updatedAt: "",
			source,
		};
		manifest.references.b = entry;
		manifest.references.a = entry;
		await writeManifest(manifest, root);
		expect(Object.keys((await readManifest("kind-a", root))?.references ?? {})).toEqual(["a", "b"]);
	});
});

describe("masks", () => {
	test("the status bar is always masked, and each moving node gets two pixels of margin, clipped to the screen", () => {
		const masks = referenceMasks(
			{ x: 0, y: 0, width: 1080, height: 128 },
			[
				{ x: 63, y: 360, width: 53, height: 54 },
				{ x: 0, y: 2390, width: 1080, height: 10 },
			],
			image(1080, 2400),
		);
		expect(masks[0]).toEqual({ name: "status bar", x: 0, y: 0, width: 1080, height: 128 });
		expect(masks[1]).toEqual({ name: "moving node 1", x: 61, y: 358, width: 57, height: 58 });
		expect(masks[2]).toEqual({ name: "moving node 2", x: 0, y: 2388, width: 1080, height: 12 });
	});
});

describe("comparison", () => {
	test("identical screenshots pass with zero differing pixels", () => {
		const result = compare(image(30, 30), image(30, 30), []);
		expect([result.verdict, result.differingPixels, result.diffImage]).toEqual(["pass", 0, null]);
	});

	test("any differing pixel outside the masks fails; inside a mask it does not", () => {
		const reference = image(30, 30);
		const actual = image(30, 30);
		actual.data.writeUInt8(0, 10 * 30 * 4 + 5 * 4);
		const outside = compare(reference, actual, []);
		expect([outside.verdict, outside.differingPixels]).toEqual(["fail", 1]);
		expect(outside.diffImage?.width).toBe(30);
		const covered = compare(reference, actual, [{ x: 4, y: 9, width: 4, height: 3 }]);
		expect([
			covered.verdict,
			covered.differingPixels,
			covered.differingMaskedPixels,
			covered.maskedPixels,
		]).toEqual(["pass", 0, 1, 12]);
	});

	test("what a reference writes is what screencap's decoder reads back", async () => {
		const root = await mkdtemp(join(tmpdir(), "native-qa-parity-"));
		const picture = image(10, 10, 9);
		const written = await writeReference("k", "n", picture, root);
		const bytes = await readFile(join(root, "k", written.file));
		expect(decodePng(bytes).data.equals(picture.data)).toBe(true);
	});
});

describe("how much of the screen the masks may cover", () => {
	const screen = { width: 100, height: 100 };

	test("the share is the covered pixels over the screen's, overlaps counted once", () => {
		expect(maskedPct([], screen)).toBe(0);
		expect(maskedPct([{ x: 0, y: 0, width: 50, height: 50 }], screen)).toBe(25);
		expect(maskedPct([{ x: 0, y: 0, width: 50, height: 50 }, { x: 25, y: 25, width: 50, height: 50 }], screen)).toBe(43.75);
		expect(maskedPct([{ x: -10, y: -10, width: 20, height: 20 }], screen)).toBe(1);
	});

	test("a reference whose masks cover more than the gate allows is refused, naming which kind of view hides the screen", () => {
		const refusal = maskRefusal(
			[
				{ name: "moving views", masks: [{ x: 0, y: 0, width: 100, height: 20 }] },
				{ name: "glass views", masks: [{ x: 0, y: 80, width: 100, height: 8 }] },
				{ name: "sheet views", masks: [{ x: 0, y: 20, width: 100, height: 20 }] },
			],
			screen,
		);
		expect(refusal).toContain("its masks cover 48.0 % of the screen, more than the 25 % the parity.maskedPct gate allows");
		expect(refusal).toContain("moving views: 1 masks, 20.0 %");
		expect(refusal).toContain("glass views: 1 masks, 8.0 %");
		expect(refusal).toContain("sheet views: 1 masks, 20.0 %");
	});

	test("masks at the limit are accepted", () => {
		expect(maskRefusal([{ name: "moving views", masks: [{ x: 0, y: 0, width: 100, height: 25 }] }], screen)).toBeNull();
		expect(maskRefusal([{ name: "moving views", masks: [{ x: 0, y: 0, width: 100, height: 26 }] }], screen)).not.toBeNull();
	});

	test("the limit is the one gates.json gates parity.maskedPct at, on both platforms", () => {
		const file = JSON.parse(readFileSync(join(import.meta.dirname, "..", "gates.json"), "utf8")) as GatesFile;
		const bar = file.gates.find((gate) => gate.id === "parity.maskedPct")?.bar;
		expect(bar).toEqual({ android: { max: maxMaskedPct }, ios: { max: maxMaskedPct } });
	});
});

describe("a reference's status bar mask", () => {
	const band = { x: 0, y: 0, width: 1080, height: 128 };
	const navigation = { name: "navigation bar", x: 0, y: 2337, width: 1080, height: 63 };

	test("the device's band is what the reference froze, or the check says to retake it", () => {
		expect(statusBarMaskProblem([{ name: "status bar", ...band }, navigation], band)).toBeNull();
		// 2 Nov: eight references were frozen with 63 px of a 128 px band, and the clock below it was compared
		const short = statusBarMaskProblem([{ name: "status bar", ...band, height: 63 }, navigation], band);
		expect(short).toContain("(0,0 1080x63) is not the device's status bar band (0,0 1080x128)");
		expect(short).toContain("retake it with --update");
		expect(statusBarMaskProblem([{ name: "status bar", ...band, width: 540 }], band)).toContain("1080x128");
		expect(statusBarMaskProblem([navigation], band)).toContain("no status bar mask");
	});

	test("what `--update` freezes passes the same check on the same device", () => {
		const masks = referenceMasks(band, [], image(1080, 2400), { x: 0, y: 2337, width: 1080, height: 63 });
		expect(statusBarMaskProblem(masks, band)).toBeNull();
		expect(statusBarMaskProblem(masks, { ...band, height: 63 })).not.toBeNull();
	});
});

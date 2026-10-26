import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
	compare,
	emptyManifest,
	readManifest,
	readReference,
	referenceMasks,
	writeManifest,
	writeReference,
	type Manifest,
} from "../lib/parity.ts";
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

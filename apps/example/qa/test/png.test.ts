import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync, crc32 } from "node:zlib";
import { describe, expect, test } from "bun:test";
import { decodePng, diffImages, encodePng, maskBitmap, type Image } from "../lib/png.ts";

function gradient(width: number, height: number, alpha = 255): Image {
	const data = Buffer.alloc(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const at = (y * width + x) * 4;
			data[at] = (x * 7 + y * 3) & 0xff;
			data[at + 1] = (x * x + y) & 0xff;
			data[at + 2] = (x ^ y) & 0xff;
			data[at + 3] = alpha;
		}
	}
	return { width, height, data };
}

function flip(buffer: Buffer, index: number, mask: number): void {
	buffer.writeUInt8((buffer.readUInt8(index) ^ mask) & 0xff, index);
}

function pngOf(
	width: number,
	height: number,
	colorType: number,
	scanlines: Buffer,
	extra: Buffer[] = [],
): Buffer {
	const chunk = (type: string, data: Buffer) => {
		const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
		const out = Buffer.alloc(body.length + 8);
		out.writeUInt32BE(data.length, 0);
		body.copy(out, 4);
		out.writeUInt32BE(crc32(body), body.length + 4);
		return out;
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = colorType;
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		...extra,
		chunk("IDAT", deflateSync(scanlines)),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

describe("png codec", () => {
	test("an opaque image round-trips exactly and is written as RGB", () => {
		const image = gradient(37, 23);
		const bytes = encodePng(image);
		expect(bytes[25]).toBe(2);
		const back = decodePng(bytes);
		expect(back.width).toBe(37);
		expect(back.height).toBe(23);
		expect(back.data.equals(image.data)).toBe(true);
	});

	test("an image with transparency round-trips as RGBA", () => {
		const image = gradient(16, 9, 200);
		const bytes = encodePng(image);
		expect(bytes[25]).toBe(6);
		expect(decodePng(bytes).data.equals(image.data)).toBe(true);
	});

	test("decodes the PNG Android's screencap writes", () => {
		const image = decodePng(
			readFileSync(join(import.meta.dirname, "samples", "screencap-startup-loading.png")),
		);
		expect([image.width, image.height]).toEqual([1080, 2400]);
		const at = (x: number, y: number) => [
			...image.data.subarray((y * 1080 + x) * 4, (y * 1080 + x) * 4 + 4),
		];
		// The page background of the light theme, #f6f6f7, well below the status bar.
		expect(at(540, 1500)).toEqual([246, 246, 247, 255]);
		// Re-encoding what was decoded loses nothing.
		expect(decodePng(encodePng(image)).data.equals(image.data)).toBe(true);
	});

	test("decodes gray, gray+alpha and palette images and every row filter", () => {
		// 3x2 gray, filter None then Sub.
		const gray = pngOf(3, 2, 0, Buffer.from([0, 10, 20, 30, 1, 5, 5, 5]));
		expect([...decodePng(gray).data]).toEqual([
			10, 10, 10, 255, 20, 20, 20, 255, 30, 30, 30, 255, 5, 5, 5, 255, 10, 10, 10, 255, 15, 15, 15,
			255,
		]);
		const grayAlpha = pngOf(1, 1, 4, Buffer.from([0, 100, 50]));
		expect([...decodePng(grayAlpha).data]).toEqual([100, 100, 100, 50]);
		const palette = pngOf(2, 1, 3, Buffer.from([0, 1, 0]), [
			(() => {
				const body = Buffer.concat([
					Buffer.from("PLTE", "latin1"),
					Buffer.from([255, 0, 0, 0, 0, 255]),
				]);
				const out = Buffer.alloc(body.length + 8);
				out.writeUInt32BE(6, 0);
				body.copy(out, 4);
				out.writeUInt32BE(crc32(body), body.length + 4);
				return out;
			})(),
		]);
		expect([...decodePng(palette).data]).toEqual([0, 0, 255, 255, 255, 0, 0, 255]);
		// Up, Average and Paeth against a known 2x3 RGB image.
		const rows = [
			[0, 10, 20, 30, 40, 50, 60],
			[2, 1, 1, 1, 1, 1, 1],
			[3, 5, 5, 5, 3, 3, 3],
		];
		const stream = Buffer.from(rows.flat());
		const decoded = decodePng(pngOf(2, 3, 2, stream));
		expect([...decoded.data.subarray(0, 8)]).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
		expect([...decoded.data.subarray(8, 16)]).toEqual([11, 21, 31, 255, 41, 51, 61, 255]);
		expect(decoded.data[16]).toBe(5 + ((0 + 11) >> 1));
		const paeth = pngOf(2, 2, 2, Buffer.from([0, 9, 9, 9, 9, 9, 9, 4, 1, 1, 1, 1, 1, 1]));
		expect(decodePng(paeth).data[8]).toBe(10);
	});

	test("rejects what it cannot decode instead of guessing", () => {
		expect(() => decodePng(Buffer.from("not a png"))).toThrow("not a PNG");
		const good = encodePng(gradient(4, 4));
		const corrupted = Buffer.from(good);
		flip(corrupted, corrupted.length - 20, 0xff);
		expect(() => decodePng(corrupted)).toThrow();
		const sixteen = Buffer.from(good);
		sixteen[24] = 16;
		expect(() => decodePng(sixteen)).toThrow();
	});
});

describe("image diff", () => {
	test("identical images differ in no pixel", () => {
		const image = gradient(20, 20);
		const diff = diffImages(image, { ...image, data: Buffer.from(image.data) }, []);
		expect(diff.differing).toBe(0);
		expect(diff.bounds).toBeNull();
	});

	test("counts every differing pixel and bounds them", () => {
		const reference = gradient(20, 20);
		const actual = { ...reference, data: Buffer.from(reference.data) };
		for (const [x, y] of [
			[3, 4],
			[10, 12],
			[11, 12],
		] as const)
			flip(actual.data, (y * 20 + x) * 4, 1);
		const diff = diffImages(reference, actual, []);
		expect(diff.differing).toBe(3);
		expect(diff.bounds).toEqual({ x: 3, y: 4, width: 9, height: 9 });
		// A one-bit difference in any channel counts: there is no tolerance.
		const alphaOnly = { ...reference, data: Buffer.from(reference.data) };
		alphaOnly.data[3] = 254;
		expect(diffImages(reference, alphaOnly, []).differing).toBe(1);
	});

	test("differences inside a mask are reported but not counted", () => {
		const reference = gradient(20, 20);
		const actual = { ...reference, data: Buffer.from(reference.data) };
		flip(actual.data, (5 * 20 + 5) * 4 + 1, 8);
		flip(actual.data, (18 * 20 + 1) * 4 + 1, 8);
		const diff = diffImages(reference, actual, [{ x: 4, y: 4, width: 4, height: 4 }]);
		expect(diff.differing).toBe(1);
		expect(diff.differingMasked).toBe(1);
		expect(diff.masked).toBe(16);
		expect(diff.bounds).toEqual({ x: 1, y: 18, width: 1, height: 1 });
	});

	test("masks are clipped to the image", () => {
		const covered = maskBitmap(10, 10, [{ x: -5, y: 8, width: 100, height: 100 }]);
		expect(covered.reduce((count, value) => count + value, 0)).toBe(20);
	});

	test("images of different sizes differ everywhere", () => {
		const diff = diffImages(gradient(10, 10), gradient(10, 12), []);
		expect(diff.differing).toBe(120);
	});

	test("the diff image marks differences red and leaves the rest dimmed", () => {
		const reference = gradient(8, 8);
		const actual = { ...reference, data: Buffer.from(reference.data) };
		flip(actual.data, 0, 1);
		const { image } = diffImages(reference, actual, []);
		expect([...image.data.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
		expect(image.data[4 + 3]).toBe(255);
		expect(image.data[4]).toBe(image.data[5]);
	});
});

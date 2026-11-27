import { crc32, deflateSync, inflateSync } from "node:zlib";

/** 8-bit RGBA pixels, row-major, no padding: `data.length === width * height * 4`. */
export type Image = { width: number; height: number; data: Buffer };

/** A rectangle in pixels; `x`,`y` is the top-left corner. */
export type Rect = { x: number; y: number; width: number; height: number };

const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type Chunk = { type: string; data: Buffer };

function chunks(file: Buffer): Chunk[] {
	if (file.length < 8 || !file.subarray(0, 8).equals(signature)) throw new Error("not a PNG file");
	const found: Chunk[] = [];
	let offset = 8;
	while (offset + 12 <= file.length) {
		const length = file.readUInt32BE(offset);
		const type = file.toString("latin1", offset + 4, offset + 8);
		const end = offset + 8 + length;
		if (end + 4 > file.length) throw new Error(`PNG chunk ${type} runs past the end of the file`);
		const data = file.subarray(offset + 8, end);
		const stored = file.readUInt32BE(end);
		if (crc32(file.subarray(offset + 4, end)) !== stored)
			throw new Error(`PNG chunk ${type} has a bad checksum`);
		found.push({ type, data });
		offset = end + 4;
		if (type === "IEND") return found;
	}
	throw new Error("PNG ends without an IEND chunk");
}

function paeth(left: number, up: number, upLeft: number): number {
	const estimate = left + up - upLeft;
	const toLeft = Math.abs(estimate - left);
	const toUp = Math.abs(estimate - up);
	const toUpLeft = Math.abs(estimate - upLeft);
	if (toLeft <= toUp && toLeft <= toUpLeft) return left;
	return toUp <= toUpLeft ? up : upLeft;
}

/** Undoes the per-row filters of a PNG scanline stream in place and returns the raw rows. */
function unfilter(raw: Buffer, width: number, height: number, bytesPerPixel: number): Buffer {
	const stride = width * bytesPerPixel;
	if (raw.length !== (stride + 1) * height)
		throw new Error(`PNG data is ${raw.length} bytes, expected ${(stride + 1) * height}`);
	const rows = Buffer.alloc(stride * height);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		const source = y * (stride + 1) + 1;
		const target = y * stride;
		for (let x = 0; x < stride; x++) {
			const value = raw[source + x] as number;
			const left = x >= bytesPerPixel ? (rows[target + x - bytesPerPixel] as number) : 0;
			const up = y > 0 ? (rows[target - stride + x] as number) : 0;
			const upLeft =
				y > 0 && x >= bytesPerPixel ? (rows[target - stride + x - bytesPerPixel] as number) : 0;
			let predicted: number;
			switch (filter) {
				case 0:
					predicted = 0;
					break;
				case 1:
					predicted = left;
					break;
				case 2:
					predicted = up;
					break;
				case 3:
					predicted = (left + up) >> 1;
					break;
				case 4:
					predicted = paeth(left, up, upLeft);
					break;
				default:
					throw new Error(`PNG row ${y} uses the unknown filter ${filter}`);
			}
			rows[target + x] = (value + predicted) & 0xff;
		}
	}
	return rows;
}

const samplesPerPixel: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Decodes an 8-bit, non-interlaced PNG of any colour type (what `screencap` and this module write) to RGBA. */
export function decodePng(file: Buffer): Image {
	const parts = chunks(file);
	const header = parts.find((chunk) => chunk.type === "IHDR")?.data;
	if (!header || header.length < 13) throw new Error("PNG has no IHDR chunk");
	const width = header.readUInt32BE(0);
	const height = header.readUInt32BE(4);
	const depth = header[8];
	const colorType = header[9] as number;
	if (depth !== 8) throw new Error(`PNG bit depth ${depth} is not supported (8 only)`);
	if (header[12] !== 0) throw new Error("interlaced PNG is not supported");
	const samples = samplesPerPixel[colorType];
	if (samples === undefined) throw new Error(`PNG colour type ${colorType} is not supported`);
	const palette = parts.find((chunk) => chunk.type === "PLTE")?.data;
	const transparency = parts.find((chunk) => chunk.type === "tRNS")?.data;
	if (colorType === 3 && !palette) throw new Error("palette PNG without a PLTE chunk");
	const compressed = Buffer.concat(
		parts.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data),
	);
	const rows = unfilter(inflateSync(compressed), width, height, samples);
	const data = Buffer.alloc(width * height * 4);
	for (let i = 0; i < width * height; i++) {
		const from = i * samples;
		const to = i * 4;
		if (colorType === 6) {
			rows.copy(data, to, from, from + 4);
		} else if (colorType === 2) {
			rows.copy(data, to, from, from + 3);
			data[to + 3] = 255;
		} else if (colorType === 0 || colorType === 4) {
			const gray = rows[from] as number;
			data[to] = data[to + 1] = data[to + 2] = gray;
			data[to + 3] = colorType === 4 ? (rows[from + 1] as number) : 255;
		} else {
			const index = (rows[from] as number) * 3;
			data[to] = palette?.[index] ?? 0;
			data[to + 1] = palette?.[index + 1] ?? 0;
			data[to + 2] = palette?.[index + 2] ?? 0;
			data[to + 3] = transparency?.[rows[from] as number] ?? 255;
		}
	}
	return { width, height, data };
}

function chunk(type: string, data: Buffer): Buffer {
	const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
	const out = Buffer.alloc(body.length + 8);
	out.writeUInt32BE(data.length, 0);
	body.copy(out, 4);
	out.writeUInt32BE(crc32(body), body.length + 4);
	return out;
}

/** The filter that minimises the sum of absolute residuals, the usual heuristic for a small file. */
function filterRow(
	rows: Buffer,
	y: number,
	stride: number,
	bytesPerPixel: number,
): { filter: number; bytes: Buffer } {
	const current = y * stride;
	const previous = (y - 1) * stride;
	let best: { filter: number; bytes: Buffer; cost: number } | null = null;
	for (let filter = 0; filter <= 4; filter++) {
		const bytes = Buffer.alloc(stride);
		let cost = 0;
		for (let x = 0; x < stride; x++) {
			const value = rows[current + x] as number;
			const left = x >= bytesPerPixel ? (rows[current + x - bytesPerPixel] as number) : 0;
			const up = y > 0 ? (rows[previous + x] as number) : 0;
			const upLeft =
				y > 0 && x >= bytesPerPixel ? (rows[previous + x - bytesPerPixel] as number) : 0;
			const predicted =
				filter === 0
					? 0
					: filter === 1
						? left
						: filter === 2
							? up
							: filter === 3
								? (left + up) >> 1
								: paeth(left, up, upLeft);
			const residual = (value - predicted) & 0xff;
			bytes[x] = residual;
			cost += residual < 128 ? residual : 256 - residual;
		}
		if (!best || cost < best.cost) best = { filter, bytes, cost };
	}
	if (!best) throw new Error("unreachable: no PNG filter evaluated");
	return { filter: best.filter, bytes: best.bytes };
}

/** Encodes RGBA pixels as a PNG, as RGB when every pixel is opaque (what a screenshot is), which is a quarter smaller. */
export function encodePng(image: Image): Buffer {
	const { width, height, data } = image;
	if (data.length !== width * height * 4)
		throw new Error(`image data is ${data.length} bytes, expected ${width * height * 4}`);
	let opaque = true;
	for (let i = 3; i < data.length; i += 4) {
		if (data[i] !== 255) {
			opaque = false;
			break;
		}
	}
	const bytesPerPixel = opaque ? 3 : 4;
	const stride = width * bytesPerPixel;
	const rows = Buffer.alloc(stride * height);
	for (let i = 0; i < width * height; i++) {
		data.copy(rows, i * bytesPerPixel, i * 4, i * 4 + bytesPerPixel);
	}
	const scanlines = Buffer.alloc((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		const { filter, bytes } = filterRow(rows, y, stride, bytesPerPixel);
		scanlines[y * (stride + 1)] = filter;
		bytes.copy(scanlines, y * (stride + 1) + 1);
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = opaque ? 2 : 6;
	return Buffer.concat([
		signature,
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(scanlines, { level: 9 })),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

export type Diff = {
	/** Pixels that differ and lie outside every mask. The gate counts these. */
	differing: number;
	/** Pixels covered by a mask, whether or not they differ. */
	masked: number;
	/** Pixels that differ inside a mask (reported so a mask that hides a lot is visible). */
	differingMasked: number;
	/** Bounding box of the differing pixels outside the masks, or null when there are none. */
	bounds: Rect | null;
	/** The reference dimmed, differing pixels red, masks tinted blue. Same size as the inputs. */
	image: Image;
};

/** Marks which pixels a list of rectangles covers (clipped to the image). */
export function maskBitmap(width: number, height: number, masks: Rect[]): Uint8Array {
	const covered = new Uint8Array(width * height);
	for (const mask of masks) {
		const x0 = Math.max(0, Math.floor(mask.x));
		const y0 = Math.max(0, Math.floor(mask.y));
		const x1 = Math.min(width, Math.ceil(mask.x + mask.width));
		const y1 = Math.min(height, Math.ceil(mask.y + mask.height));
		for (let y = y0; y < y1; y++) covered.fill(1, y * width + x0, y * width + x1);
	}
	return covered;
}

/**
 * Compares two images of the same size pixel by pixel (all four channels, no tolerance). The bar of the parity
 * suite is zero differing pixels outside the masks, so there is no fuzz and no anti-aliasing allowance here.
 * Images of different sizes differ in every pixel of the larger one.
 */
export function diffImages(reference: Image, actual: Image, masks: Rect[]): Diff {
	if (reference.width !== actual.width || reference.height !== actual.height) {
		const width = Math.max(reference.width, actual.width);
		const height = Math.max(reference.height, actual.height);
		return {
			differing: width * height,
			masked: 0,
			differingMasked: 0,
			bounds: { x: 0, y: 0, width, height },
			image: {
				width: reference.width,
				height: reference.height,
				data: Buffer.from(reference.data),
			},
		};
	}
	const { width, height } = reference;
	const covered = maskBitmap(width, height, masks);
	const out = Buffer.alloc(width * height * 4);
	let differing = 0;
	let masked = 0;
	let differingMasked = 0;
	let minX = width;
	let minY = height;
	let maxX = -1;
	let maxY = -1;
	for (let i = 0; i < width * height; i++) {
		const at = i * 4;
		const same =
			reference.data[at] === actual.data[at] &&
			reference.data[at + 1] === actual.data[at + 1] &&
			reference.data[at + 2] === actual.data[at + 2] &&
			reference.data[at + 3] === actual.data[at + 3];
		const gray = Math.round(
			((reference.data[at] as number) +
				(reference.data[at + 1] as number) +
				(reference.data[at + 2] as number)) /
				3,
		);
		const dim = 160 + (gray >> 2);
		if (covered[i]) {
			masked++;
			if (!same) differingMasked++;
			out[at] = dim >> 1;
			out[at + 1] = dim >> 1;
			out[at + 2] = dim;
		} else if (same) {
			out[at] = out[at + 1] = out[at + 2] = dim;
		} else {
			differing++;
			const x = i % width;
			const y = (i - x) / width;
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
			out[at] = 255;
			out[at + 1] = 0;
			out[at + 2] = 0;
		}
		out[at + 3] = 255;
	}
	return {
		differing,
		masked,
		differingMasked,
		bounds: differing
			? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
			: null,
		image: { width, height, data: out },
	};
}


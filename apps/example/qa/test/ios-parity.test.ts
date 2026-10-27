import { describe, expect, test } from "bun:test";
import { glassMasks, sheetMasks } from "../commands/ios-parity.ts";
import type { CaptureEntry } from "../lib/iphone/capture.ts";
import { maskedPct, maskRefusal } from "../lib/parity.ts";

const entry = (glass: number[][], scale = 2) => ({ scale, glass }) as unknown as CaptureEntry;

describe("masks for the system's glass capsules", () => {
	test("a wide capsule is masked at its two ends and along its top and bottom edge, its inside is compared", () => {
		// the tab bar of an iPhone SE 3: 275 x 62 pt at (50, 584), two pixels per point; ends are half the height and 6 pt more, edges 6 pt,
		// a 4 pt halo outside the frame for the blur and 24 pt below it for the shadow
		const masks = glassMasks(entry([[50, 584, 275, 62]]));
		expect(masks).toEqual([
			{ x: 100 - 8, y: 1168 - 8, width: 74 + 8, height: 124 + 8 + 48 },
			{ x: 100 + 550 - 74, y: 1168 - 8, width: 74 + 8, height: 124 + 8 + 48 },
			{ x: 100 - 8, y: 1168 - 8, width: 550 + 16, height: 12 + 8 },
			{ x: 100 - 8, y: 1168 + 124 - 12, width: 550 + 16, height: 12 + 48 },
		]);
	});

	test("a capsule less than one and a half times as wide as it is tall is masked whole", () => {
		expect(glassMasks(entry([[307, 20, 56, 44]]))).toEqual([{ x: 614 - 8, y: 40 - 8, width: 112 + 16, height: 88 + 8 + 48 }]);
	});

	test("no glass, no masks", () => {
		expect(glassMasks(entry([]))).toEqual([]);
		expect(glassMasks({ scale: 2 } as unknown as CaptureEntry)).toEqual([]);
	});
});

describe("masks for a presented sheet's card", () => {
	test("the corners and a strip along each side, inside and outside the frame, are masked; the inside is compared", () => {
		// the sheet of the lab at one detent: 359 x 248 pt at (8, 411), two pixels per point
		const masks = sheetMasks({ scale: 2, sheets: [[8, 411, 359, 248]] } as unknown as CaptureEntry);
		expect(masks).toHaveLength(8);
		// 8 pt outside the frame (32 above it), corners 64 pt square, strips 6 pt inside and 8 pt outside
		expect(masks[0]).toEqual({ x: 0, y: 758, width: 144, height: 192 });
		expect(masks[4]).toEqual({ x: 0, y: 758, width: 28, height: 576 });
		expect(masks[5]).toEqual({ x: 16 + 718 + 16 - 28, y: 758, width: 28, height: 576 });
		expect(sheetMasks({ scale: 2 } as unknown as CaptureEntry)).toEqual([]);
	});
});

describe("the masks of a capture against the gate", () => {
	const phone = { width: 750, height: 1334 };
	const capture = (fields: object) => ({ scale: 2, ...fields }) as unknown as CaptureEntry;

	test("the lab's sheet and the tab bar together stay within the 25 % the gate allows", () => {
		const entry = capture({ sheets: [[8, 411, 359, 248]], glass: [[50, 584, 275, 62], [307, 20, 56, 44]] });
		const parts = [
			{ name: "moving views", masks: [] },
			{ name: "glass views", masks: glassMasks(entry) },
			{ name: "sheet views", masks: sheetMasks(entry) },
		];
		const share = maskedPct(parts.flatMap((part) => part.masks), phone);
		expect(share).toBeGreaterThan(19);
		expect(share).toBeLessThan(25);
		expect(maskRefusal(parts, phone)).toBeNull();
	});

	test("a spinner view that spans most of the screen is refused at update, with the three kinds of view named", () => {
		const entry = capture({ sheets: [[8, 411, 359, 248]] });
		const refusal = maskRefusal(
			[
				{ name: "moving views", masks: [{ x: 0, y: 0, width: 750, height: 800 }] },
				{ name: "glass views", masks: glassMasks(entry) },
				{ name: "sheet views", masks: sheetMasks(entry) },
			],
			phone,
		);
		expect(refusal).toContain("its masks cover");
		expect(refusal).toContain("moving views: 1 masks, 60.0 %");
		expect(refusal).toContain("glass views: 0 masks, 0.0 %");
		expect(refusal).toContain("sheet views: 8 masks, 15.8 %");
	});
});

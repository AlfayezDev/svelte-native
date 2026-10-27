import { describe, expect, test } from "bun:test";
import { glassMasks, sheetMasks } from "../commands/ios-parity.ts";
import type { CaptureEntry } from "../lib/iphone/capture.ts";

const entry = (glass: number[][], scale = 2) => ({ scale, glass }) as unknown as CaptureEntry;

describe("masks for the system's glass capsules", () => {
	test("a wide capsule is masked at its two ends and along its top and bottom edge, its inside is compared", () => {
		// the tab bar of an iPhone SE 3: 275 x 62 pt at (50, 584), two pixels per point
		const masks = glassMasks(entry([[50, 584, 275, 62]]));
		expect(masks).toEqual([
			{ x: 100, y: 1168, width: 62, height: 124 },
			{ x: 100 + 550 - 62, y: 1168, width: 62, height: 124 },
			{ x: 100, y: 1168, width: 550, height: 4 },
			{ x: 100, y: 1168 + 124 - 4, width: 550, height: 4 },
		]);
	});

	test("a capsule less than one and a half times as wide as it is tall is masked whole", () => {
		expect(glassMasks(entry([[307, 20, 56, 44]]))).toEqual([{ x: 614, y: 40, width: 112, height: 88 }]);
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
		expect(masks[0]).toEqual({ x: 10, y: 816, width: 70, height: 70 });
		expect(masks[4]).toEqual({ x: 10, y: 816, width: 12, height: 508 });
		expect(masks[5]).toEqual({ x: 16 + 718 + 6 - 12, y: 816, width: 12, height: 508 });
		expect(sheetMasks({ scale: 2 } as unknown as CaptureEntry)).toEqual([]);
	});
});

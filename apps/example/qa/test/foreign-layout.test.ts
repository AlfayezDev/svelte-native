import { describe, expect, test } from "bun:test";
import { compareLayout, viewInside, type Inspected } from "../../src/lib/native/dev/foreign-layout.ts";

/**
 * The layout check of the native-view libraries, on what the iPhone's inspector answered (the first iOS foreign run,
 * `foreign-E74A5608-...-20261103T122249Z-libraries.log`): the section's box is 1 dp of border wider than the content on every side, the card of
 * `ShadowedView` is a view of its own, and the SwiftUI `HostingView` of `expo-conic-gradient` fills the content. Pixels at density 2.
 */
const box = (width: number, height: number, views: string[]): Inspected => ({ class: "RCTViewComponentView", width, height, density: 2, views });
const hosting = "HostingView<ConicGradientProps, ConicGradientView>";
const conicBox = box(718, 192, [`${hosting} 714x188 clip=none`, "  _UIHostingView<AnyView> 714x188 clip=none", "RCTParagraphComponentView 87x39 clip=none", "  RCTParagraphTextView 87x39 clip=none"]);
const shadowBox = box(718, 192, ["RCTViewComponentView 216x76 clip=none", "  RCTViewComponentView 144x36 clip=none", "    RCTParagraphComponentView 144x36 clip=none", "      RCTParagraphTextView 144x36 clip=none"]);
const card = box(216, 76, ["RCTViewComponentView 144x36 clip=none", "  RCTParagraphComponentView 144x36 clip=none"]);

describe("the view inside", () => {
	test("is found by its class, however a Swift generic spells it, and read in pixels", () => {
		expect(viewInside(conicBox.views, hosting)).toEqual({ width: 714, height: 188 });
		expect(viewInside(conicBox.views, "_UIHostingView<AnyView>")).toEqual({ width: 714, height: 188 });
		expect(viewInside(shadowBox.views, "RCTParagraphTextView")).toEqual({ width: 144, height: 36 });
	});
	test("is not found by the name of a generic argument, a prefix or a class that is not listed", () => {
		expect(viewInside(conicBox.views, "ConicGradientView")).toBeNull();
		expect(viewInside(conicBox.views, "HostingView")).toBeNull();
		expect(viewInside(conicBox.views, "RCTParagraph")).toBeNull();
		expect(viewInside([], "ConicGradientView")).toBeNull();
	});
});

describe("the conic gradient", () => {
	test("its hosting view has the size of the content, inside a box with a border", () => {
		expect(compareLayout(conicBox, hosting, false, { width: 357, height: 94 })).toEqual({ passed: true, detail: "native 357.0x94.0 dp, measured 357.0x94.0" });
	});
	test("the box around it is never its size: without the pinned view in the tree the check has nothing to compare, not a pass and not 2 dp wrong", () => {
		const verdict = compareLayout(conicBox, "ConicGradientView", false, { width: 357, height: 94 });
		expect(verdict.passed).toBe(false);
		expect(verdict.detail).toContain("no native view to size");
		expect(verdict.detail).not.toContain("359.0x96.0");
	});
	test("a hosting view of another size fails, by more than a point", () => {
		const verdict = compareLayout(box(718, 192, [`${hosting} 718x192 clip=none`]), hosting, false, { width: 357, height: 94 });
		expect(verdict).toEqual({ passed: false, detail: "native 359.0x96.0 dp, measured 357.0x94.0" });
	});
});

describe("the shadowed card", () => {
	test("on iOS the card's own view has the size of its layout", () => {
		expect(compareLayout(card, undefined, true, { width: 108, height: 38 })).toEqual({ passed: true, detail: "native 108.0x38.0 dp, measured 108.0x38.0" });
	});
	test("the box around the cards is not the card's view: it fills the width, as the run on the phone showed", () => {
		const verdict = compareLayout(shadowBox, undefined, false, { width: 108, height: 38 });
		expect(verdict.passed).toBe(false);
		expect(verdict.detail).toContain("no native view to size");
		// the view that is the card is in the box's tree, at the size the engine measured
		expect(viewInside(shadowBox.views, "RCTViewComponentView")).toEqual({ width: 216, height: 76 });
		expect(compareLayout(shadowBox, "RCTViewComponentView", false, { width: 108, height: 38 }).passed).toBe(true);
	});
	test("on Android the pinned FastShadowView and ConicGradientView inside the box are the measured size (OVH emulator run foreign-localhost_5555-20261102T230816Z, density 2.625)", () => {
		const shadowAndroid: Inspected = { class: "expo.modules.svelteengine.views.EngineView", width: 1032, height: 252, density: 2.625, views: ["EngineForeign 283x107 clip=none", "  FastShadowView 283x107 clip=none", "EngineView 188x54 clip=none", "  EngineText 188x54 clip=none"] };
		expect(compareLayout(shadowAndroid, "FastShadowView", false, { width: 107.8, height: 40.8 })).toEqual({ passed: true, detail: "native 107.8x40.8 dp, measured 107.8x40.8" });
		const conicAndroid: Inspected = { class: "expo.modules.svelteengine.views.EngineView", width: 1032, height: 252, density: 2.625, views: ["EngineForeign 1032x247 clip=none", "  ConicGradientView 1032x247 clip=children", "EngineText 108x57 clip=none"] };
		expect(compareLayout(conicAndroid, "ConicGradientView", false, { width: 393.1, height: 94.1 }).passed).toBe(true);
	});
});

describe("the check", () => {
	test("falls back to the inspected view only when it is the measured one", () => {
		const own = box(714, 188, ["RNPDFPdfView 714x188 clip=none"]);
		expect(compareLayout(own, "PDFView", true, { width: 357, height: 94 }).passed).toBe(true);
		expect(compareLayout(own, "PDFView", false, { width: 357, height: 94 }).passed).toBe(false);
	});
	test("fails when the engine measured no layout", () => {
		expect(compareLayout(card, undefined, true, null)).toEqual({ passed: false, detail: "native 108.0x38.0 dp, measured none" });
	});
	test("allows a point and no more, each way", () => {
		const view = box(714, 188, []);
		expect(compareLayout(view, undefined, true, { width: 358, height: 93 }).passed).toBe(true);
		expect(compareLayout(view, undefined, true, { width: 358.1, height: 94 }).passed).toBe(false);
		expect(compareLayout(view, undefined, true, { width: 357, height: 92.9 }).passed).toBe(false);
	});
});

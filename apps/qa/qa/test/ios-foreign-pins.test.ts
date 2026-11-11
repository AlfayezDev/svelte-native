import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pins, resolvePin, type Mounted, type Pinned } from "../../src/lib/native/dev/foreign-pins.ts";
import type { GatesFile } from "../lib/gates.ts";
import { platformDir } from "../lib/paths.ts";
import { sample } from "./sample.ts";

type Library = keyof typeof pins;
type Tree = Mounted & { measured: { width: number; height: number } };

/** What `SvelteQA.inspect` said of each library's section on the first iPhone run: the class of the section's view, the first entries of the tree below it, the layout the engine measured. */
const recorded = JSON.parse(sample("ios-foreign-trees.json")) as { density: number; libraries: Record<string, Tree> };
const gates = JSON.parse(readFileSync(join(platformDir, "qa/gates.json"), "utf8")) as GatesFile;
/**
 * The libraries added after the first iPhone run (3 Nov 2026), which have a pin and no recorded tree yet: the built-in BlurView (11 Nov 2026; its iOS name, `SvelteBlurView`, is from the Swift source). The first iPhone run
 * of each puts its tree into `samples/ios-foreign-trees.json`, and it comes off this list in the same commit (the test below fails while a library is on it and recorded).
 */
const unrecorded: readonly string[] = ["svelteblur"];
const pinned = gates.foreign?.libraries.ios ?? [];
/** The libraries the recorded trees cover. */
const libraries = pinned.filter((library) => !unrecorded.includes(library));
const treeOf = (library: string): Tree => {
	const tree = recorded.libraries[library];
	if (!tree) throw new Error(`no recorded tree for ${library}`);
	return tree;
};
const pinOf = (library: string): Pinned => {
	const pinned = (pins as Record<string, Pinned>)[library];
	if (!pinned) throw new Error(`no pin for ${library}`);
	return pinned;
};
/** The same tree with every view a plain `UIView`: nothing of any library is in it. */
const emptied = (tree: Mounted): Mounted => ({ class: "UIView", views: tree.views.map((view) => view.replace(/^(\s*)\S+/, "$1UIView")) });
/** The tree without the views that start with [name]. */
const without = (tree: Mounted, name: string): Mounted => ({ ...tree, views: tree.views.filter((view) => !view.trim().startsWith(`${name} `)) });

describe("the iOS pin of each library, against the view trees the first iPhone run printed", () => {
	test("every pinned library has a pin and a recorded tree, except the ones listed as not recorded yet", () => {
		expect(Object.keys(pins).sort()).toEqual([...pinned].sort());
		expect(Object.keys(recorded.libraries).sort()).toEqual([...libraries].sort());
		for (const library of unrecorded) expect([library, library in recorded.libraries]).toEqual([library, false]);
	});

	test("the built-in blur's pin is the Swift class below its container, spelled without a module, and Android's the Kotlin class's simple name", () => {
		expect(pins.svelteblur).toEqual({ inside: "SvelteBlurView", ios: { inside: "SvelteBlurView" } });
		// the section's handle names the container View; the view is below it, as the entries of `SvelteQA.inspect` and `SvelteEngine.inspect` spell it (a name and a size)
		expect(resolvePin(false, pins.svelteblur, { class: "RCTViewComponentView", views: ["SvelteBlurView 618x132 clip=bounds", "  UIVisualEffectView 618x132 clip=none"] })).toMatchObject({ there: true, name: "SvelteBlurView inside" });
		expect(resolvePin(true, pins.svelteblur, { class: "expo.modules.svelteengine.views.EngineView", views: ["SvelteBlurView 618x132 clip=children"] })).toMatchObject({ there: true, name: "SvelteBlurView", entry: "SvelteBlurView 618x132 clip=children" });
		// expo-blur's own view is not it, and neither is the visual-effect view alone
		expect(resolvePin(false, pins.svelteblur, { class: "RCTViewComponentView", views: ["ExpoBlurView 618x132 clip=bounds", "  BlurEffectView 618x132 clip=none"] }).there).toBe(false);
		expect(resolvePin(true, pins.svelteblur, { class: "x", views: ["ExpoBlurView 1x1"] }).there).toBe(false);
	});

	test("each pin finds the library's own view in the tree the phone built for it", () => {
		for (const library of libraries) {
			expect([library, resolvePin(false, pinOf(library), treeOf(library)).there]).toEqual([library, true]);
		}
	});

	test("the four views that were named wrongly are named as iOS holds them", () => {
		// expo-blur: a Swift class of the module ExpoBlur, below the container the handle names; Swift prints no module for a subview.
		expect(resolvePin(false, pins.blur, treeOf("blur"))).toMatchObject({ there: true, name: "ExpoBlurView inside" });
		// lottie-react-native: the Fabric component view, then the container the Swift source calls `ContainerView` (`@objc(LottieContainerView)` is only its Objective-C name).
		expect(resolvePin(false, pins.lottie, treeOf("lottie"))).toMatchObject({ there: true, name: "LottieAnimationViewComponentView, ContainerView inside" });
		// react-native-pdf: a Fabric view of its own holding PDFKit's view, not the interop view.
		expect(resolvePin(false, pins.pdf, treeOf("pdf"))).toMatchObject({ there: true, name: "RNPDFPdfView, PDFView inside" });
		// expo-conic-gradient: a SwiftUI struct, mounted in expo-modules-core's generic hosting view.
		expect(resolvePin(false, pins.conic, treeOf("conic"))).toMatchObject({ there: true, name: "HostingView<ConicGradientProps, ConicGradientView> inside" });
	});

	test("a tree without the library's view fails its pin, in every library", () => {
		for (const library of libraries) expect([library, resolvePin(false, pinOf(library), emptied(treeOf(library))).there]).toEqual([library, false]);
	});

	test("a pin with two names needs both: the container without the library's view, and the view without its container", () => {
		for (const [library, host, inside] of [["lottie", "LottieAnimationViewComponentView", "ContainerView"], ["pdf", "RNPDFPdfView", "PDFView"], ["video", "RCTLegacyViewManagerInteropComponentView", "RCTVideo"], ["rive", "RCTLegacyViewManagerInteropComponentView", "RiveReactNativeView"]] as const) {
			const tree = treeOf(library);
			expect(tree.class).toBe(host);
			expect([library, resolvePin(false, pinOf(library), without(tree, inside)).there]).toEqual([library, false]);
			expect([library, resolvePin(false, pinOf(library), { ...tree, class: "RCTViewComponentView" }).there]).toEqual([library, false]);
		}
	});

	test("a view that only looks like the library's is not it", () => {
		// the blur's visual-effect view without expo-blur's container; SwiftUI's own hosting view without expo's; the container's prefix.
		expect(resolvePin(false, pins.blur, { class: "RCTViewComponentView", views: ["BlurEffectView 618x132 clip=none", "  _UIVisualEffectBackdropView 618x132 clip=none"] }).there).toBe(false);
		expect(resolvePin(false, pins.conic, { class: "RCTViewComponentView", views: ["_UIHostingView<AnyView> 714x188 clip=none"] }).there).toBe(false);
		expect(resolvePin(false, pins.conic, { class: "RCTViewComponentView", views: ["HostingView<OtherProps, OtherView> 714x188 clip=none"] }).there).toBe(false);
		expect(resolvePin(false, pins.lottie, { class: "LottieAnimationViewComponentView", views: ["ContainerViewFoo 714x188 clip=none"] }).there).toBe(false);
	});

	test("what is read for the layout check is the pinned view's own size, which is the layout the engine measured", () => {
		for (const library of ["blur", "gradient", "video", "lottie", "pdf", "rive", "conic", "shadow"] as const) {
			const tree = treeOf(library);
			const { entry } = resolvePin(false, pins[library], tree);
			expect(entry).toBeDefined();
			const size = /(\d+)x(\d+)\s*(?:clip=\w+)?\s*$/.exec(entry ?? "");
			expect(size).not.toBeNull();
			expect([library, Number(size?.[1]) / recorded.density, Number(size?.[2]) / recorded.density]).toEqual([library, tree.measured.width, tree.measured.height]);
		}
	});

	test("the shadow's card, the first plain view in the section's box, is the view that has the card's layout (not the box with its border)", () => {
		const { entry } = resolvePin(false, pins.shadow, treeOf("shadow"));
		expect(entry).toBe("RCTViewComponentView 216x76 clip=none");
		expect(treeOf("shadow").measured).toEqual({ width: 108, height: 38 });
	});

	test("a name below the section is the Swift name `String(describing:)` prints: no module in front, and only the section's own class may carry one", () => {
		for (const [library, pinned] of Object.entries(pins) as [Library, Pinned][]) {
			if (pinned.ios.inside !== undefined) expect([library, pinned.ios.inside.includes(".")]).toEqual([library, false]);
		}
		expect(pins.image.ios.host).toBe("ExpoImage.ImageView");
	});
});

describe("the Android pins are read as they were", () => {
	const trees: Record<string, Mounted> = {
		image: { class: "expo.modules.image.ExpoImageViewWrapper", views: ["FrameLayout 1032x247 clip=true"] },
		blur: { class: "expo.modules.svelteengine.views.EngineView", views: ["ExpoBlurView 618x132 clip=children"] },
	};
	test("a host pin compares the class of the section's view, an inside pin looks for a view below it", () => {
		expect(resolvePin(true, pins.image, trees.image as Mounted)).toEqual({ name: "expo.modules.image.ExpoImageViewWrapper", there: true, entry: undefined });
		expect(resolvePin(true, pins.image, { ...(trees.image as Mounted), class: "android.view.View" }).there).toBe(false);
		expect(resolvePin(true, pins.blur, trees.blur as Mounted)).toMatchObject({ name: "ExpoBlurView", there: true, entry: "ExpoBlurView 618x132 clip=children" });
		expect(resolvePin(true, pins.blur, { class: "x", views: ["FrameLayout 1x1"] }).there).toBe(false);
	});
});

import { expect, test } from "bun:test";
import { applyInlineStyle, computedStyleOf, effectiveStyle, entriesToOps, parseLength, parseOrigin, parseTransform, transformRect, transformToCss } from "../../src/fabric/dom-style.ts";
import { parseKeyframes, restoreValues, sampleSpec, type Keyframe, type Spec } from "../../src/fabric/keyframes.ts";

// Svelte's keyframes (what `element.animate` receives) as tracks, and the sampling of tracks: opacity, every transform form, px lengths, colours, what is dropped.
const spec = (keyframes: Keyframe[], options = { duration: 100, fill: "forwards" as const }) => {
  const warnings: string[] = [];
  const parsed = parseKeyframes(keyframes, options, (key, message) => warnings.push(`${key}: ${message}`));
  return { parsed, warnings };
};
const at = (parsed: Spec, progress: number) => {
  const out: Record<string, unknown> = {};
  sampleSpec(parsed, progress, out);
  return out;
};

test("a transform list is read as React Native's operations, in order", () => {
  const ops = (text: string) => parseTransform(text).ops.map(({ name, unit, value }) => `${name}:${value}${unit}`);
  expect(ops("translate(0px, 20px)")).toEqual(["translateX:0", "translateY:20"]);
  expect(ops("translate(10px)")).toEqual(["translateX:10", "translateY:0"]);
  expect(ops("translateX(5px) translateY(-6px)")).toEqual(["translateX:5", "translateY:-6"]);
  expect(ops("translate(50%, 0)")).toEqual(["translateX:50%", "translateY:0"]);
  expect(ops("scale(0.5)")).toEqual(["scale:0.5"]);
  expect(ops("scale(2, 3)")).toEqual(["scaleX:2", "scaleY:3"]);
  expect(ops("scaleX(2) scaleY(0.5)")).toEqual(["scaleX:2", "scaleY:0.5"]);
  expect(ops("rotate(90deg)")).toEqual(["rotate:90deg"]);
  expect(ops("rotate(0.25turn)")).toEqual(["rotate:90deg"]);
  expect(ops("rotate(200grad)")).toEqual(["rotate:180deg"]);
  expect(parseTransform("rotate(1.5707963267948966rad)").ops[0]?.value).toBeCloseTo(90, 9);
  expect(ops("skewX(10deg) skewY(5deg)")).toEqual(["skewX:10deg", "skewY:5deg"]);
  expect(ops("perspective(400px) rotateY(30deg)")).toEqual(["perspective:400", "rotateY:30deg"]);
  // what a transition writes: a number with an exponent and an existing transform in front
  expect(ops("translateX(3px) scale(1.2) translate(1e-7px, -4.440892098500626e-16px)")).toEqual(["translateX:3", "scale:1.2", "translateX:1e-7", "translateY:-4.440892098500626e-16"]);
  expect(ops("none")).toEqual([]);
  expect(ops("")).toEqual([]);
  const unsupported = parseTransform("scale(2) matrix(1, 0, 0, 1, 0, 0) translateZ(1px)");
  expect(unsupported.ops.map((op) => op.name)).toEqual(["scale"]);
  expect(unsupported.unsupported).toEqual(["matrix", "translateZ"]);
});

test("React Native's transform as the CSS list getComputedStyle gives, and the lengths a keyframe may have", () => {
  expect(transformToCss([{ translateX: 10 }, { scale: 2 }, { rotate: "45deg" }, { translateY: "50%" }])).toBe("translateX(10px) scale(2) rotate(45deg) translateY(50%)");
  expect(transformToCss(undefined)).toBe("none");
  expect(transformToCss([])).toBe("none");
  expect(transformToCss("translateX(4px)")).toBe("translateX(4px)");
  expect(parseTransform(transformToCss([{ translateX: 10 }, { scaleX: 2 }, { rotate: "45deg" }])).ops.map((op) => `${op.name}:${op.value}`)).toEqual(["translateX:10", "scaleX:2", "rotate:45"]);
  expect(parseLength("12px")).toEqual({ value: 12, unit: "" });
  expect(parseLength("0.5")).toEqual({ value: 0.5, unit: "" });
  expect(parseLength("50%")).toEqual({ value: 50, unit: "%" });
  expect(parseLength("1e-7px")).toEqual({ value: 1e-7, unit: "" });
  expect(parseLength("2em")).toBeNull();
  expect(parseLength("auto")).toBeNull();
  expect(parseLength("calc(1px + 2px)")).toBeNull();
});

test("opacity and px lengths become number tracks, sampled linearly between the keyframes", () => {
  const { parsed, warnings } = spec([{ opacity: "0", height: "0px" }, { opacity: "0.5", height: "20px" }, { opacity: "1", height: "40px" }]);
  expect(warnings).toEqual([]);
  expect(parsed.empty).toBe(false);
  expect(parsed.constant).toBe(false);
  expect(parsed.keys.sort()).toEqual(["height", "opacity"]);
  expect(parsed.scalars.find((track) => track.key === "opacity")?.values).toEqual([0, 0.5, 1]);
  expect(at(parsed, 0)).toEqual({ opacity: 0, height: 0 });
  expect(at(parsed, 0.25)).toEqual({ opacity: 0.25, height: 10 });
  expect(at(parsed, 0.5)).toEqual({ opacity: 0.5, height: 20 });
  expect(at(parsed, 0.75)).toEqual({ opacity: 0.75, height: 30 });
  expect(at(parsed, 1)).toEqual({ opacity: 1, height: 40 });
});

test("a transform whose functions are the same in every keyframe is one track of numbers", () => {
  const { parsed, warnings } = spec([
    { transform: "translateX(4px) translate(0px, 20px)", opacity: 0 },
    { transform: "translateX(4px) translate(0px, 10px)", opacity: 0.5 },
    { transform: "translateX(4px) translate(0px, 0px)", opacity: 1 },
  ]);
  expect(warnings).toEqual([]);
  expect(parsed.ops?.map((op) => op.name)).toEqual(["translateX", "translateX", "translateY"]);
  expect(at(parsed, 0.5)).toEqual({ opacity: 0.5, transform: [{ translateX: 4 }, { translateX: 0 }, { translateY: 10 }] });
  const rotating = spec([{ transform: "rotate(0deg) scale(1)" }, { transform: "rotate(90deg) scale(0.5)" }]).parsed;
  expect(at(rotating, 0.5).transform).toEqual([{ rotate: "45deg" }, { scale: 0.75 }]);
  const percent = spec([{ transform: "translateY(100%)" }, { transform: "translateY(0%)" }]).parsed;
  expect(at(percent, 0.25).transform).toEqual([{ translateY: "75%" }]);
});

test("transform lists that are not the same functions are shown one after the other, and a list that is none is nothing", () => {
  const { parsed } = spec([{ transform: "translateX(10px)" }, { transform: "scale(2)" }]);
  expect(parsed.ops).toBeNull();
  expect(at(parsed, 0.25).transform).toEqual([{ translateX: 10 }]);
  expect(at(parsed, 0.75).transform).toEqual([{ scale: 2 }]);
  expect(spec([{ transform: "none" }, { transform: "none" }]).parsed.empty).toBe(true);
});

test("unsupported properties are dropped with a warning and the rest plays", () => {
  const { parsed, warnings } = spec([{ opacity: 0, filter: "blur(5px)", strokeDasharray: "10", transform: "scale(0.5) matrix(1, 0, 0, 1, 0, 0)" }, { opacity: 1, filter: "blur(0px)", strokeDasharray: "10", transform: "scale(1) matrix(1, 0, 0, 1, 0, 0)" }]);
  expect(parsed.keys.sort()).toEqual(["opacity", "transform"]);
  expect(at(parsed, 0.5)).toEqual({ opacity: 0.5, transform: [{ scale: 0.75 }] });
  expect(warnings.map((warning) => warning.slice(0, warning.indexOf(": ")))).toEqual(["filter", "strokeDasharray", "transform:matrix"]); // once each, not once per keyframe
  expect(warnings[0]).toContain("blur");
});

test("overflow is not a track, colours are, other strings are shown one after the other", () => {
  const { parsed } = spec([{ overflow: "hidden", backgroundColor: "#ff0000", transformOrigin: "top left", zIndex: "1" }, { overflow: "hidden", backgroundColor: "rgba(0, 0, 255, 0.5)", transformOrigin: "bottom right", zIndex: "3" }]);
  expect(parsed.keys.sort()).toEqual(["backgroundColor", "transformOrigin", "zIndex"]);
  expect(at(parsed, 0.5)).toEqual({ zIndex: 2, backgroundColor: "rgba(170, 0, 85, 0.75)", transformOrigin: "bottom right" });
  expect(at(parsed, 0.25).transformOrigin).toBe("top left");
});

test("colours are read in hex and rgb() forms; a name is not a colour that is played, and is shown as it is", () => {
  const colours = (...values: string[]) => spec(values.map((backgroundColor) => ({ backgroundColor }))).parsed;
  expect(colours("#f00", "#00ff0080").colours[0]?.values).toEqual([[255, 0, 0, 1], [0, 255, 0, 128 / 255]]);
  expect(colours("rgb(255 0 0 / 50%)", "rgba(0, 0, 255, 1)").colours[0]?.values).toEqual([[255, 0, 0, 0.5], [0, 0, 255, 1]]);
  expect(colours("rgb(100%, 0%, 0%)", "rgb(0, 0, 0)").colours[0]?.values[0]).toEqual([255, 0, 0, 1]);
  const named = spec([{ backgroundColor: "red" }, { backgroundColor: "blue" }]);
  expect(named.parsed.colours).toEqual([]);
  expect(at(named.parsed, 0.25)).toEqual({ backgroundColor: "red" });
  expect(at(named.parsed, 0.75)).toEqual({ backgroundColor: "blue" });
  // not blended, and said so (once): a name, oklch(), ... is shown one keyframe after the other
  expect(named.warnings).toHaveLength(1);
  expect(named.warnings[0]).toContain("`red`");
  expect(spec([{ color: "oklch(0.7 0.1 200)" }, { color: "#ffffff" }]).warnings).toHaveLength(1);
});

test("hsl() and transparent are colours that are blended", () => {
  const colours = (...values: string[]) => spec(values.map((backgroundColor) => ({ backgroundColor })));
  const hsl = colours("hsl(120 100% 25%)", "hsla(240, 100%, 50%, 0.5)");
  expect(hsl.warnings).toEqual([]);
  expect(hsl.parsed.colours[0]?.values).toEqual([[0, 128, 0, 1], [0, 0, 255, 0.5]]);
  expect(colours("hsl(0deg 0% 100%)", "transparent").parsed.colours[0]?.values).toEqual([[255, 255, 255, 1], [0, 0, 0, 0]]);
  expect(colours("hsl(60, 100%, 50% / 50%)", "#000000").parsed.colours[0]?.values[0]).toEqual([255, 255, 0, 0.5]);
  // a hue in other units of angle is still a hue
  expect(colours("hsl(0.5turn 100% 50%)", "#000000").parsed.colours[0]?.values[0]).toEqual([0, 255, 255, 1]);
  expect(colours("hsl(200grad 100% 50%)", "#000000").parsed.colours[0]?.values[0]).toEqual([0, 255, 255, 1]);
  expect(colours(`hsl(${Math.PI}rad 100% 50%)`, "#000000").parsed.colours[0]?.values[0]).toEqual([0, 255, 255, 1]);
  expect(colours("hsl(0.5turn 100% 50%)", "#000000").warnings).toEqual([]);
});

test("a property that is missing from a keyframe takes the nearest keyframe's value", () => {
  const { parsed } = spec([{ opacity: "0" }, { opacity: "1", height: "10px" }, { height: "30px" }]);
  expect(parsed.scalars.find((track) => track.key === "opacity")?.values).toEqual([0, 1, 1]);
  expect(parsed.scalars.find((track) => track.key === "height")?.values).toEqual([10, 10, 30]);
});

test("a hold (every keyframe the same) is constant; no keyframes, or none that can be drawn, is empty", () => {
  const hold = spec([{ opacity: "0", transform: "translate(0px, 20px)" }, { opacity: "0", transform: "translate(0px, 20px)" }], { duration: 300, fill: "forwards" });
  expect(hold.parsed.constant).toBe(true);
  expect(hold.parsed.empty).toBe(false);
  expect(hold.parsed.total).toBe(300);
  expect(spec([]).parsed.empty).toBe(true);
  expect(spec([{ filter: "blur(1px)" }, { filter: "blur(0px)" }]).parsed.empty).toBe(true);
});

test("fill and delay: nothing before the delay, nothing after the end, unless the fill says so", () => {
  const keyframes = [{ opacity: "0.2" }, { opacity: "0.8" }];
  const none = spec(keyframes, { delay: 100, duration: 300, fill: "none" as never }).parsed;
  expect(none.total).toBe(400);
  expect(at(none, 0.1)).toEqual({});
  expect(at(none, 0.25)).toEqual({ opacity: 0.2 });
  expect(at(none, 0.625)).toEqual({ opacity: 0.5 });
  expect(at(none, 1)).toEqual({});
  const forwards = spec(keyframes, { delay: 100, duration: 300, fill: "forwards" }).parsed;
  expect(at(forwards, 0.1)).toEqual({});
  expect(at(forwards, 1)).toEqual({ opacity: 0.8 });
  const both = spec(keyframes, { delay: 100, duration: 300, fill: "both" as never }).parsed;
  expect(at(both, 0)).toEqual({ opacity: 0.2 });
  expect(at(both, 1)).toEqual({ opacity: 0.8 });
  // a hold of no length with a forwards fill draws its keyframe at once, and a single keyframe is a constant
  const instant = spec([{ opacity: "0.3" }], { duration: 0, fill: "forwards" }).parsed;
  expect(at(instant, 1)).toEqual({ opacity: 0.3 });
});

test("restoring a cancelled animation gives the node's own values back: every key it wrote, reset (null, never undefined) when the node has none", () => {
  const { parsed } = spec([{ opacity: 0, transform: "scale(0)", height: "0px", paddingTop: "0px", borderTopWidth: "0px", backgroundColor: "#000000", transformOrigin: "top left" }, { opacity: 1, transform: "scale(1)", height: "10px", paddingTop: "4px", borderTopWidth: "1px", backgroundColor: "#ffffff", transformOrigin: "top left" }]);
  // Reanimated's JSI conversion drops an `undefined`, so a key the node has no value for is `null`; a colour cannot be (the colour processor throws): `transparent` for a background.
  const bare = restoreValues(parsed, {});
  expect(bare).toEqual({ opacity: 1, transform: [], height: null, paddingTop: null, borderTopWidth: null, backgroundColor: "transparent", transformOrigin: "50% 50%" });
  expect(Object.values(bare).includes(undefined)).toBe(false);
  expect(restoreValues(parsed, { opacity: 0.8, transform: [{ rotate: "10deg" }], height: 40, paddingTop: 3, borderTopWidth: 2, backgroundColor: "red", transformOrigin: "center" })).toEqual({
    opacity: 0.8, transform: [{ rotate: "10deg" }], height: 40, paddingTop: 3, borderTopWidth: 2, backgroundColor: "red", transformOrigin: "center",
  });
  // every key of the spec is in it
  expect(Object.keys(bare).sort()).toEqual([...parsed.keys].sort());
  // a colour the node has no value for and that has no neutral one is left out, not written as undefined or null
  const text = spec([{ color: "#000000", borderTopColor: "#000000" }, { color: "#ffffff", borderTopColor: "#ffffff" }]).parsed;
  expect(restoreValues(text, {})).toEqual({});
  expect(restoreValues(text, { color: "#123456" })).toEqual({ color: "#123456" });
});

test("colours are blended premultiplied by their alpha, as CSS does: transparent to red is half red at the half, not a pink", () => {
  const { parsed } = spec([{ backgroundColor: "transparent" }, { backgroundColor: "#ff0000" }]);
  expect(at(parsed, 0)).toEqual({ backgroundColor: "rgba(0, 0, 0, 0)" });
  expect(at(parsed, 0.5)).toEqual({ backgroundColor: "rgba(255, 0, 0, 0.5)" });
  expect(at(parsed, 1)).toEqual({ backgroundColor: "rgba(255, 0, 0, 1)" });
  // opaque colours are blended channel by channel, as before
  const opaque = spec([{ backgroundColor: "#000000" }, { backgroundColor: "#ff8040" }]).parsed;
  expect(at(opaque, 0.5)).toEqual({ backgroundColor: "rgba(128, 64, 32, 1)" });
});

test("a transform origin is the point it names in a box, and a transform moves a box about it", () => {
  const size = { width: 100, height: 50 };
  expect(parseOrigin(undefined, size)).toEqual({ x: 50, y: 25 });
  expect(parseOrigin("top left", size)).toEqual({ x: 0, y: 0 });
  expect(parseOrigin("left top", size)).toEqual({ x: 0, y: 0 });
  expect(parseOrigin("bottom right", size)).toEqual({ x: 100, y: 50 });
  expect(parseOrigin("top", size)).toEqual({ x: 50, y: 0 });
  expect(parseOrigin("left", size)).toEqual({ x: 0, y: 25 });
  expect(parseOrigin("25% 10px", size)).toEqual({ x: 25, y: 10 });
  expect(parseOrigin(["10%", 5, 0], size)).toEqual({ x: 10, y: 5 });
  expect(parseOrigin("nonsense", size)).toEqual({ x: 50, y: 25 });
  const box = { x: 10, y: 20, width: 100, height: 50 };
  const ops = (text: string) => parseTransform(text).ops;
  expect(transformRect(box, ops("scale(0.5)"), { x: 0, y: 0 })).toEqual({ x: 10, y: 20, width: 50, height: 25 }); // about the top left the corner stays
  expect(transformRect(box, ops("scale(0.5)"), { x: 50, y: 25 })).toEqual({ x: 35, y: 32.5, width: 50, height: 25 }); // about the centre it moves
  expect(transformRect(box, ops("translate(5px, -5px) scale(2)"), { x: 50, y: 25 })).toEqual({ x: -35, y: -10, width: 200, height: 100 });
  expect(transformRect(box, ops("scale(2) translate(5px, -5px)"), { x: 50, y: 25 })).toEqual({ x: -30, y: -15, width: 200, height: 100 }); // the order of the list matters
  expect(transformRect(box, ops("translateX(50%)"), { x: 50, y: 25 })).toEqual({ x: 60, y: 20, width: 100, height: 50 });
  expect(transformRect(box, ops("rotate(45deg)"), { x: 50, y: 25 })).toBe(box); // not applied
  expect(entriesToOps([{ translateX: 3 }, { scale: 2 }, { rotate: "30deg" }, { translateY: "10%" }])).toEqual([
    { name: "translateX", unit: "", value: 3 }, { name: "scale", unit: "", value: 2 }, { name: "rotate", unit: "deg", value: 30 }, { name: "translateY", unit: "%", value: 10 },
  ]);
});

test("getComputedStyle gives what the transitions read, and asks for the layout only when a size is read", () => {
  let layouts = 0;
  const layout = () => { layouts++; return { x: 0, y: 0, width: 120, height: 48 }; };
  const props = { nativeStyle: [{ opacity: 0.5, transform: [{ translateX: 10 }], padding: 8, paddingTop: 2, marginHorizontal: 4 }, { borderWidth: 1 }] };
  const style = computedStyleOf(props, null, layout);
  expect(style.opacity).toBe("0.5");
  expect(style.transform).toBe("translateX(10px)");
  expect([style.paddingTop, style.paddingBottom, style.paddingLeft, style.marginLeft, style.marginTop, style.borderTopWidth]).toEqual(["2px", "8px", "8px", "4px", "0px", "1px"]);
  expect([style.display, style.position, style.filter, style.zoom]).toEqual(["flex", "relative", "none", "1"]);
  expect(layouts).toBe(0);
  expect([style.height, style.width, style.transformOrigin]).toEqual(["48px", "120px", "60px 24px"]);
  expect(layouts).toBe(3);
  expect(parseFloat(computedStyleOf({}, null, () => null).height)).toBe(0);
  expect(computedStyleOf({}, null, () => null).opacity).toBe("1");
  expect(computedStyleOf({}, null, () => null).transform).toBe("none");
});

test("what is written to node.style goes over the node's style: sizes in px, the transform after the node's own", () => {
  const props: Record<string, unknown> = { style: [{ padding: 4 }, { transform: [{ scale: 2 }] }] };
  applyInlineStyle(props, { position: "absolute", width: "100px", height: "50px", transform: "translate(1px, 2px)", overflow: "hidden" });
  expect(props.style).toEqual([[{ padding: 4 }, { transform: [{ scale: 2 }] }], { position: "absolute", width: 100, height: 50, transform: [{ scale: 2 }, { translateX: 1 }, { translateY: 2 }], overflow: "hidden" }]);
  const bare: Record<string, unknown> = {};
  applyInlineStyle(bare, { height: "50%" });
  expect(bare.style).toEqual({ height: "50%" });
  expect(effectiveStyle({ nativeStyle: { opacity: 0.4, width: 10 } }, { width: "20px" })).toEqual({ opacity: 0.4, width: 20 });
});

test("getComputedStyle has the colours and radii of the merged style, the style of a class included, and the origin as px", () => {
  const props = {
    nativeClass: [{ backgroundColor: "#336699", borderRadius: 8 }, { borderTopLeftRadius: 2 }],
    nativeStyle: { color: 0xff112233, borderColor: "red", borderTopColor: "blue", transformOrigin: "top left" },
  };
  const style = computedStyleOf(props, null, () => ({ width: 120, height: 48 }));
  expect(style.backgroundColor).toBe("#336699"); // from the class
  expect(style.color).toBe("rgba(17, 34, 51, 1)"); // an ARGB integer, as React Native processes a colour
  expect([style.borderColor, style.borderTopColor, style.borderLeftColor]).toEqual(["red", "blue", "red"]); // a side falls back to the whole border's
  expect([style.borderRadius, style.borderTopLeftRadius, style.borderTopRightRadius]).toEqual(["8px", "2px", "8px"]);
  expect(style.transformOrigin).toBe("0px 0px");
  const bare = computedStyleOf({}, null, () => null);
  expect([bare.backgroundColor, bare.color, bare.borderRadius, bare.transformOrigin]).toEqual(["rgba(0, 0, 0, 0)", "rgb(0, 0, 0)", "0px", "0px 0px"]);
});

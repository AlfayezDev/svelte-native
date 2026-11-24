import { test, expect } from "bun:test";
import { loadReference, withReactNativeGlobals, type Platform, type RegisteredConfig } from "../support/rn-reference.ts";
import { random } from "../support/random.ts";

type Table = Record<string, unknown>;
type Payload = Record<string, unknown> | null;
const platforms: Platform[] = ["android", "ios"];
const names: Record<Platform, string[]> = {
  android: ["RCTView", "RCTText", "RCTVirtualText", "RCTScrollView", "AndroidTextInput", "RCTImageView", "AndroidSwitch", "AndroidProgressBar", "RCTModalHostView", "RCTSafeAreaView"],
  ios: ["RCTView", "RCTText", "RCTVirtualText", "RCTScrollView", "RCTSinglelineTextInputView", "RCTMultilineTextInputView", "RCTImageView", "RCTSwitch", "RCTActivityIndicatorView", "RCTModalHostView", "RCTSafeAreaView"],
};
const timeout = 30_000;

/** An outcome comparable with `toEqual`: the value (`undefined` and `NaN` spelled out) or the message of the error thrown. */
function outcome(run: () => unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(run() ?? null, (_key, value) => (value === undefined ? "__undefined__" : typeof value === "number" && Number.isNaN(value) ? "__NaN__" : typeof value === "function" ? "__function__" : value)) ?? "null") as unknown;
  } catch (error) {
    return { thrown: error instanceof Error ? error.message : String(error) };
  }
}

const colors: unknown[] = [
  "#fff", "#FFF", "#abcd", "#ABCD", "#ffffff", "#FFFFFF", "#191b1e", "#ffffff80", "#12345678", "#1234567", "#12", "#gggggg", "",
  "rgb(1,2,3)", "rgb(1, 2, 3)", "rgba(0,0,0,0.5)", "rgba(10, 20, 30, 0.25)", "rgb(1,2,3,0.5)", "rgba(1,2,3)", "rgba(300, -5, 7.9, 2)", "rgba(1,2,3,-1)",
  "rgba(.5, +1, -.5, .5)", "rgb(255 0 0 / 50%)", "rgb(255 0 0)", "RGBA(0,0,0,1)", " rgb(1,2,3)", "rgba(0,0,0,0.5) ",
  "red", "transparent", "rebeccapurple", "hsl(120, 100%, 50%)", "hsla(120, 100%, 50%, 0.5)", "hwb(120 0% 0%)", "not a color",
  0, 255, 0xff0000ff, 0xffffffff, 4294967295, 4294967296, -1, 1.5, Number.NaN, null, true, {}, { resource_paths: ["?attr/colorPrimary"] }, { semantic: "label" }, { dynamic: { light: "red", dark: "blue" } },
];
const samples: Record<string, unknown[]> = {
  processColor: colors,
  processTransform: [[{ translateX: 10 }], [{ scale: 2 }, { rotate: "45deg" }], [], "translateX(10px) scale(2)", "rotate(45deg)", "translate(10px, 5px)"],
  processTransformOrigin: [["50%", "50%", 0], [10, 20, 0], "top left", "10px 20px", "center", "right bottom 5px", "25% 75%", "left center", "bottom right", ["100%", "0%", 0], ["100%", 0, 0]],
  processAspectRatio: [1.5, 0, 2, "16/9", "2", "auto", "1 / 2", "x"],
  processFontVariant: [["tabular-nums"], [], "small-caps oldstyle-nums", "", "  lining-nums  "],
  processFilter: [[{ blur: 5 }], [], "blur(5px) brightness(0.5)", "grayscale(50%)"],
  processBoxShadow: [
    [{ offsetX: 1, offsetY: 2, blurRadius: 3, color: "red" }], [], "1px 2px 3px red", "inset 0 0 5px rgba(0,0,0,0.5)",
    // The box shadows the Android engine draws with React Native's drawables (the lab page of apps/qa): a focus ring and its halo, an inset line, a card, a hairline, one that is off.
    "0 0 0 1px #66666f, 0 0 0 4px rgba(9,9,11,0.07)", "inset 0 0 0 1px #66666f", "0 10px 30px -10px rgba(9,9,11,0.18)", "0 1px 2px rgba(0,0,0,0.08)", "0 0 0 0 transparent",
    "inset 0 0 0 3px #f59e0b, 0 2px 8px rgba(9,9,11,0.35), 6px 6px 0 -2px #f97316",
    [{ offsetX: 2, offsetY: 4, blurRadius: 6, spreadDistance: 1, color: "rgba(0,0,0,0.4)" }, { offsetX: 0, offsetY: 0, blurRadius: 10, color: "#3b82f6", inset: true }],
  ],
  processBackgroundImage: ["linear-gradient(to right, red, blue)", [], [{ type: "linear-gradient", direction: "to right", colorStops: [{ color: "red", positions: ["0%"] }, { color: "blue", positions: ["100%"] }] }]],
  processBackgroundSize: ["cover", "contain", "50% 50%", [{ x: "50%", y: "50%" }]],
  processBackgroundPosition: ["center", "top left", "10px 20px", [{ top: "10%", left: "20%" }]],
  processBackgroundRepeat: ["repeat", "no-repeat", "repeat-x", [{ x: "repeat", y: "no-repeat" }]],
  processFontVariationSettings: [{ wght: 700 }, { wght: 700, wdth: 100 }, {}, "'wght' 700, 'wdth' 100", "'wght' 700", { abcd: Number.NaN }, { toolong: 1 }, { "'ab'": 1 }],
  resolveAssetSource: [{ uri: "https://example.com/a.png" }, { uri: "file:///a.png", width: 4, height: 2 }, null],
};

function sameAttributes(path: string, reference: Table, mine: Table, converters: Set<string>) {
  expect(Object.keys(mine).sort(), path).toEqual(Object.keys(reference).sort());
  for (const key of Object.keys(reference)) {
    const expected = reference[key] as true | { process?: (value: unknown) => unknown; diff?: unknown } | Table;
    const actual = mine[key];
    if (expected === true) expect(actual, `${path}.${key}`).toBe(true);
    else if (typeof (expected as { process?: unknown }).process === "function") {
      const process = (expected as { process: (value: unknown) => unknown }).process;
      expect(typeof actual, `${path}.${key}`).toBe("function");
      const kind = process.name;
      converters.add(kind);
      expect(samples[kind], `a sample list for ${kind}`).toBeDefined();
      for (const sample of samples[kind]) expect(outcome(() => (actual as (value: unknown) => unknown)(sample)), `${path}.${key} ${kind}(${JSON.stringify(sample)})`).toEqual(outcome(() => process(sample)));
    } else if (typeof (expected as { diff?: unknown }).diff === "function") expect(actual, `${path}.${key}`).toBe(true);
    else {
      expect(typeof actual, `${path}.${key}`).toBe("object");
      sameAttributes(`${path}.${key}`, expected as Table, actual as Table, converters);
    }
  }
}

const eventsOf = (config: RegisteredConfig): Record<string, string> => ({
  ...Object.fromEntries(Object.entries(config.bubblingEventTypes ?? {}).map(([type, event]) => [type, event.phasedRegistrationNames.bubbled])),
  ...Object.fromEntries(Object.entries(config.directEventTypes ?? {}).map(([type, event]) => [type, event.registrationName])),
});

/**
 * Attributes a table has beyond React Native's: `selection` on Android, where React Native's TextInput sets it with the `setTextAndSelection` command and the
 * engine reads it from the props instead (native/svelte-core/SPEC.md, "TextInput: selection and autofill").
 */
const additions: Readonly<Record<string, readonly string[]>> = { AndroidTextInput: ["selection"] };

for (const platform of platforms) {
  test(`${platform}: every static table has React Native's attributes, converters and events`, async () => {
    const reference = await loadReference(platform);
    const converters = new Set<string>();
    for (const name of names[platform]) {
      const registered = reference.get(name);
      const mine = reference.configs.viewConfigFor(name, platform);
      expect(mine.foreign, name).toBe(false);
      const attributes = { ...(mine.attributes as Table) };
      for (const extra of additions[name] ?? []) {
        expect(Object.hasOwn(attributes, extra), `${name}.${extra}`).toBe(true);
        expect(Object.hasOwn(registered.validAttributes, extra), `${name}.${extra} is React Native's now: drop the addition`).toBe(false);
        delete attributes[extra];
      }
      sameAttributes(name, registered.validAttributes, attributes, converters);
      expect(Object.fromEntries(mine.events), `${name} events`).toEqual(eventsOf(registered));
      expect(reference.configs.viewConfigFor(name, platform), `${name} is built once`).toBe(mine);
    }
    expect([...converters].sort()).toEqual(Object.keys(samples).filter((kind) => kind !== "resolveAssetSource" || platform === "ios").sort());
  }, timeout);

  test(`${platform}: colours become the integers React Native's processColor makes`, async () => {
    const reference = await loadReference(platform);
    const view = reference.configs.viewConfigFor("RCTView", platform);
    const registered = reference.get("RCTView");
    for (const color of colors) {
      for (const props of [{ backgroundColor: color }, { style: [{ borderColor: color }, { color }] }]) {
        expect(outcome(() => reference.configs.createPayload(props, view)), JSON.stringify(color)).toEqual(outcome(() => reference.create(props, registered.validAttributes)));
      }
    }
    const create = (backgroundColor: string) => reference.configs.createPayload({ backgroundColor }, view)?.backgroundColor;
    expect(create("#ffffff")).toBe(platform === "android" ? -1 : 4294967295);
    expect(create("#000000")).toBe(platform === "android" ? -16777216 : 4278190080);
    expect(create("rgba(0,0,0,0.5)")).toBe(platform === "android" ? 2147483648 | 0 : 2147483648);
  }, timeout);

  test(`${platform}: a box shadow layer without a colour ${platform === "android" ? "is black, as React Native's Android views draw it, and `transparent` stays 0" : "is sent as React Native sends it"}`, async () => {
    const reference = await loadReference(platform);
    const view = reference.configs.viewConfigFor("RCTView", platform);
    const registered = reference.get("RCTView");
    const payload = (boxShadow: unknown) => (reference.configs.createPayload({ style: { boxShadow } }, view) as { boxShadow: Array<Record<string, unknown>> }).boxShadow;
    const same = ["0 0 0 1px #66666f, 0 0 0 4px rgba(9,9,11,0.07)", "inset 0 0 0 1px #66666f", "0 0 0 0 transparent", "0 10px 30px -10px rgba(9,9,11,0.18)"];
    for (const boxShadow of same) expect(payload(boxShadow), boxShadow).toEqual((reference.create({ style: { boxShadow } }, registered.validAttributes) as { boxShadow: unknown }).boxShadow);
    expect(payload("0 0 0 0 transparent")[0]?.color).toBe(0);
    const bare = payload("0 2px 4px");
    expect(bare).toHaveLength(1);
    expect(bare[0]?.color, "the layer's colour").toBe(platform === "android" ? -16777216 : undefined);
    expect(payload([{ offsetX: 1, offsetY: 2 }, { offsetX: 3, offsetY: 4, color: "red" }]).map((layer) => layer.color)).toEqual(platform === "android" ? [-16777216, -65536] : [undefined, platform === "android" ? -65536 : 4294901760]);
  }, timeout);

  test(`${platform}: a colour answers the same when it is converted again and after the colour cache filled up and emptied`, async () => {
    const reference = await loadReference(platform);
    const view = reference.configs.viewConfigFor("RCTView", platform);
    const registered = reference.get("RCTView");
    const spellings = Array.from({ length: 700 }, (_, index) => `rgb(${index % 256}, ${(index * 7) % 256}, ${Math.floor(index / 3) % 256})`);
    // Two rounds: the first fills the cache past its limit (it empties itself), the second finds some entries and recomputes the rest.
    for (let round = 0; round < 2; round++) {
      for (const backgroundColor of [...spellings, "red", "#191b1e", "not a color"]) {
        const props = { backgroundColor };
        expect(outcome(() => reference.configs.createPayload(props, view)), backgroundColor).toEqual(outcome(() => reference.create(props, registered.validAttributes)));
      }
    }
  }, timeout);
}

/** `ours` is the payload this builder sends where React Native sends something else that leaves the native side with the same props. */
type Case = { name: string; previous: object; next: object; ours?: Payload };
const sharedValue = { value: 1, _isReanimatedSharedValue: true };
const onPress = () => {};
const cases: Case[] = [
  { name: "a changed number", previous: { style: { padding: 4 } }, next: { style: { padding: 5 } } },
  { name: "nothing changed", previous: { style: { padding: 4 }, testID: "a" }, next: { style: { padding: 4 }, testID: "a" } },
  { name: "equal objects in new arrays", previous: { style: { transform: [{ scale: 2 }] }, hitSlop: { top: 1, left: 2, right: 3, bottom: 4 } }, next: { style: { transform: [{ scale: 2 }] }, hitSlop: { top: 1, left: 2, right: 3, bottom: 4 } } },
  { name: "a changed array element", previous: { style: { transform: [{ scale: 2 }] } }, next: { style: { transform: [{ scale: 3 }] } } },
  { name: "a longer array", previous: { style: { transform: [{ scale: 2 }] } }, next: { style: { transform: [{ scale: 2 }, { translateX: 1 }] } } },
  { name: "a removed style key", previous: { style: { padding: 4, opacity: 1 } }, next: { style: { padding: 4 } } },
  { name: "a removed prop", previous: { testID: "a", accessible: true }, next: { accessible: true } },
  { name: "every style removed", previous: { style: [{ padding: 4 }, { opacity: 1 }] }, next: {} },
  { name: "a style array replaced by an object", previous: { style: [{ padding: 4 }, { opacity: 1 }] }, next: { style: { padding: 4 } } },
  { name: "later entries win", previous: { style: [{ padding: 1 }, { padding: 2 }] }, next: { style: [{ padding: 1 }, { padding: 3 }] } },
  { name: "a key moved between entries", previous: { style: [{ padding: 1, opacity: 1 }, {}] }, next: { style: [{ padding: 1 }, { opacity: 1 }] }, ours: null },
  { name: "falsy style entries", previous: { style: [false, { padding: 1 }, null, undefined] }, next: { style: [{ padding: 1 }, false] }, ours: null },
  { name: "nested style arrays", previous: { style: [[{ padding: 1 }], { opacity: 0.5 }] }, next: { style: [[{ padding: 2 }], { opacity: 0.5 }] } },
  { name: "an undefined value", previous: { style: { opacity: 1 }, testID: "a" }, next: { style: { opacity: undefined }, testID: undefined } },
  { name: "a handler appears and disappears", previous: { testID: "a" }, next: { testID: "a", onLayout: onPress } },
  { name: "a handler is replaced by another", previous: { onLayout: () => {} }, next: { onLayout: () => {} } },
  { name: "a handler becomes true", previous: { onLayout: () => {} }, next: { onLayout: true }, ours: null },
  { name: "a colour changes", previous: { style: { backgroundColor: "#ffffff" } }, next: { style: { backgroundColor: "#000000" } } },
  { name: "the same colour spelled differently", previous: { style: { backgroundColor: "#fff" } }, next: { style: { backgroundColor: "#ffffff" } }, ours: null },
  { name: "an invalid colour", previous: { style: { backgroundColor: "#ffffff" } }, next: { style: { backgroundColor: "not a colour" } }, ours: { backgroundColor: null } },
  { name: "a shared value is not a plain number", previous: { style: { opacity: sharedValue } }, next: { style: { opacity: sharedValue } } },
  { name: "keys that are not native props", previous: { class: "a", activityState: 2, onDismissed: onPress }, next: { class: "b", activityState: 1, onDismissed: onPress } },
  { name: "a transform string", previous: { style: { transform: "scale(2)" } }, next: { style: { transform: "scale(3)" } } },
  { name: "text input props", previous: { text: "a", mostRecentEventCount: 1 }, next: { text: "ab", mostRecentEventCount: 2 } },
];

/** Applies a payload the way the native side does: a key set to `null` is dropped, anything else replaces. */
function apply(state: Record<string, unknown>, payload: Payload): Record<string, unknown> {
  const next = { ...state };
  for (const [key, value] of Object.entries(payload ?? {})) { if (value === null || value === undefined) delete next[key]; else next[key] = value; }
  return next;
}

for (const platform of platforms) {
  test(`${platform}: payloads for hand-written cases equal React Native's`, async () => {
    const reference = await loadReference(platform);
    const config = reference.configs.viewConfigFor("RCTView", platform);
    const registered = reference.get("RCTView").validAttributes;
    for (const { name, previous, next, ours } of cases) {
      expect(outcome(() => reference.configs.createPayload(next as Record<string, unknown>, config)), `create: ${name}`).toEqual(outcome(() => reference.create(next, registered)));
      const mine = reference.configs.diffPayload(previous as Record<string, unknown>, next as Record<string, unknown>, config);
      const expected = reference.diff(previous, next, registered);
      if (ours === undefined) expect(outcome(() => mine), `diff: ${name}`).toEqual(outcome(() => expected));
      else {
        // React Native repeats a key that moved between style entries or array positions, or that changed spelling only, and sends `undefined` for a rejected colour.
        expect(mine, `diff: ${name}`).toEqual(ours);
        expect(expected, `React Native's diff: ${name}`).not.toEqual(ours);
        const base = apply({}, reference.create(previous, registered));
        expect(apply(base, mine)).toEqual(apply(base, expected));
      }
    }
  }, timeout);
}

test("a value set both as a prop and in a style stays when the style goes away, which React Native's update clears", async () => {
  const reference = await loadReference("android");
  const config = reference.configs.viewConfigFor("RCTView", "android");
  const registered = reference.get("RCTView").validAttributes;
  const previous = { borderRadius: 6, style: { borderRadius: 6 } };
  const next = { borderRadius: 6 };
  expect(reference.configs.diffPayload(previous, next, config)).toBeNull();
  expect(reference.diff(previous, next, registered)).toEqual({ borderRadius: null });
});

test("an update carries only what changed, null for what went away, and nothing when equal", async () => {
  const { configs } = await loadReference("android");
  const config = configs.viewConfigFor("RCTView", "android");
  expect(configs.diffPayload({ style: { padding: 4, opacity: 1 }, testID: "a" }, { style: { padding: 5, opacity: 1 }, testID: "a" }, config)).toEqual({ padding: 5 });
  expect(configs.diffPayload({ style: { padding: 4 }, testID: "a" }, { style: {} }, config)).toEqual({ padding: null, testID: null });
  expect(configs.diffPayload({ style: [{ padding: 1 }, { padding: 2 }] }, { style: [{ padding: 2 }, { padding: 2 }] }, config)).toBeNull();
  expect(configs.diffPayload({ style: { transform: [{ scale: 2 }] } }, { style: { transform: [{ scale: 2 }] } }, config)).toBeNull();
  expect(configs.diffPayload({ onLayout: () => {} }, { onLayout: () => {} }, config)).toBeNull();
  expect(configs.diffPayload({}, { onLayout: () => {} }, config)).toEqual({ onLayout: true });
  expect(configs.createPayload({ style: [{ padding: 1 }, false, { padding: 2, flex: 1 }], class: "x", activityState: 2 }, config)).toEqual({ padding: 2, flex: 1 });
  expect(configs.createPayload({ class: "x" }, config)).toBeNull();
});

const values: Record<string, () => unknown[]> = {
  opacity: () => [0, 0.5, 1, undefined, null],
  padding: () => [0, 4, 8, undefined],
  width: () => [10, "50%", undefined],
  backgroundColor: () => ["#fff", "#ffffff", "#000", "rgba(0,0,0,0.5)", "red", "bogus", undefined],
  transform: () => [[{ scale: 2 }], [{ scale: 2 }], [{ translateX: 3 }], [], undefined],
  borderRadius: () => [0, 6, undefined],
  testID: () => ["a", "b", undefined],
  accessible: () => [true, false, undefined],
  onLayout: () => [() => {}, () => {}, true, false, undefined],
  hitSlop: () => [{ top: 1, left: 1, right: 1, bottom: 1 }, { top: 1, left: 1, right: 1, bottom: 1 }, { top: 2, left: 1, right: 1, bottom: 1 }, undefined],
  pointerEvents: () => ["none", "auto", undefined],
  class: () => ["x", "y", undefined],
  activityState: () => [1, 2, undefined],
};
const styleKeys = ["opacity", "padding", "width", "backgroundColor", "transform", "borderRadius", "class"];
const propKeys = ["testID", "accessible", "onLayout", "hitSlop", "pointerEvents", "activityState", ...styleKeys];

function props(next: () => number): Record<string, unknown> {
  const pick = <T,>(list: T[]): T => list[Math.floor(next() * list.length)];
  const entry = (): unknown => {
    if (next() < 0.15) return pick([false, null, undefined]);
    const style: Record<string, unknown> = {};
    for (let count = Math.floor(next() * 4); count > 0; count--) { const key = pick(styleKeys); style[key] = pick(values[key]()); }
    return style;
  };
  const result: Record<string, unknown> = {};
  for (let count = Math.floor(next() * 5); count > 0; count--) { const key = pick(propKeys); result[key] = pick(values[key]()); }
  const shape = next();
  if (shape < 0.3) result.style = entry();
  else if (shape < 0.8) result.style = Array.from({ length: Math.floor(next() * 4) }, () => (next() < 0.1 ? [entry(), entry()] : entry()));
  return result;
}

for (const platform of platforms) {
  test(`${platform}: randomly generated props create what React Native creates, and an update lands on what creating the new props gives`, async () => {
    const reference = await loadReference(platform);
    const config = reference.configs.viewConfigFor("RCTView", platform);
    const registered = reference.get("RCTView").validAttributes;
    const next = random(platform === "android" ? 1 : 2);
    for (let round = 0; round < 3000; round++) {
      const previous = props(next);
      const current = props(next);
      const detail = `${JSON.stringify(previous)} -> ${JSON.stringify(current)}`;
      const base = apply({}, reference.configs.createPayload(previous, config));
      expect(base, `create ${detail}`).toEqual(apply({}, reference.create(previous, registered)));
      const updated = apply(base, reference.configs.diffPayload(previous, current, config));
      expect(updated, `diff ${detail}`).toEqual(apply({}, reference.create(current, registered)));
    }
  }, timeout);
}

test("a view name outside the tables takes React Native's registry entry and payload code", async () => {
  const reference = await loadReference("android");
  const { configs } = reference;
  const config = withReactNativeGlobals(() => configs.viewConfigFor("RCTSwitch", "android")); // registered by React Native, not part of the Android table
  const registered = reference.get("RCTSwitch");
  expect(config.foreign).toBe(true);
  expect(Object.fromEntries(config.events)).toEqual(eventsOf(registered));
  const props = { value: true, onChange: () => {}, tintColor: "#ffffff", style: [{ padding: 2 }] };
  expect(configs.createPayload(props, config)).toEqual(reference.create(props, registered.validAttributes));
  expect(configs.diffPayload(props, { ...props, value: false }, config)).toEqual(reference.diff(props, { ...props, value: false }, registered.validAttributes));
  expect(configs.viewConfigFor("RCTSwitch", "android")).toBe(config);
  expect(() => withReactNativeGlobals(() => configs.viewConfigFor("NoSuchView", "android"))).toThrow(/NoSuchView/);
});

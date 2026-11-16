import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { decodeRecords, navigationProps } from "../../src/fabric/navigation.ts";
import { cppHost, hostTools } from "../support/native-host.ts";

/**
 * The pure C++ parts of the iOS screens module (`native/svelte-core/ios/screens/Core`: the nativeID reader, the stack planner, the sheet detents), built with the host's C++ compiler
 * and compared with the reference implementations: the decoder reads every nativeID the encoders build, and the hostile ones, into the records the reference decoder returns. The bridges
 * that put those nativeIDs on the views are in `navigation/screens-ios.test.ts`. (`native-tools.test.ts` fails on CI when no compiler is there.)
 */
const module = resolve(import.meta.dirname, "../../native/svelte-core/ios/screens");
const records = hostTools("g++") ? cppHost({
  name: "screens-ios-records",
  sources: [resolve(module, "../../test/ios/records_dump.cpp"), resolve(module, "Core/SvelteNativeID.cpp")],
  dependencies: [resolve(module, "Core/SvelteNativeID.h"), resolve(module, "Core/SvelteScreensCore.h")],
  flags: ["-std=c++20", "-Wall", "-Wextra", "-Werror", "-O1"],
}) : undefined;
const native = test.skipIf(records === undefined);

function run(mode: "records" | "plan" | "detent", lines: string[]): string[] {
  const result = Bun.spawnSync([(records as NonNullable<typeof records>).binary(), mode], { stdin: new TextEncoder().encode(`${lines.join("\n")}\n`), stderr: "pipe" });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  return result.stdout.toString().split("\n").slice(0, -1);
}

/** The records the C++ reader printed for each id equal what the reference decoder returns (through JSON, as NaN and Infinity cannot cross it). */
function expectSameRecords(ids: readonly string[], printed: readonly string[]) {
  expect(printed).toHaveLength(ids.length);
  for (const [index, id] of ids.entries()) expect(JSON.parse(printed[index]), id).toEqual(JSON.parse(JSON.stringify(decodeRecords(id))));
}

const golden = [
  "svelte:stack",
  "svelte:screen;a=2;p=push;g=1;s=default;b=1",
  "svelte:screen;a=1;p=transparentModal;g=0;s=slide_from_bottom;b=0",
  "svelte:screen;a=2;p=modal;g=1;s=fade;b=1",
  "svelte:screen;a=2;p=formSheet;g=1;s=none;b=1",
  "svelte:screen;a=2;p=formSheet;g=1;s=default;b=1;gr=1;dm=0;bd=1",
  "svelte:screen;a=2;p=sheet;g=1;s=default;b=1",
  "svelte:screen;a=2;p=sheet;g=1;s=default;b=1;dt=auto,0.75,1,0.1;di=1;gr=0;dm=0;bd=1;ss=l;sx=1;nc=102030ff;ns=d",
  "svelte:screen;a=2;p=push;g=1;s=default;b=1;ss=d",
  "svelte:header",
  "svelte:header;t=A%3BB%3DC%2C%20100%25;st=sub;bt=Back;l=1;tl=1;bk=1;hs=1;tc=ffffffff;bg=00000080;sl=3",
  "svelte:header;l=1;sl=15",
  "svelte:header-left",
  "svelte:header-center",
  "svelte:header-right",
  "svelte:header-search",
  "svelte:header-search;ph=Search%E2%80%A6;v=a%20b;ec=4",
  "svelte:tabs",
  "svelte:tabs;sel=2;sc=5;tc=0a84ffff;uc=8e8e93ff;bg=ffffffff;lb=1",
  "svelte:tab",
  "svelte:tab;k=in%2Fbox;t=Inbox;ic=asset%3A%2Fa%20b.png;is=https%3A%2F%2Fx%2Fy.png%3Fa%3D1%26b%3D2;bd=99%2B;ds=1",
  "svelte:tab;k=me;t=Me;iv=1;bd=",
  "svelte:tab-icon",
  "svelte:bogus",
  "view-1",
  "",
];

// Inputs an encoder never produces; native readers must still agree with the reference decoder on them.
const hostile = [
  "svelte:screen",
  "svelte:screen;a=;g=x;p=weird;s=weird;b=2",
  "svelte:screen;a=2x;g= 3;b=-1;p=sheet;dt=;di=7",
  "svelte:screen;p=sheet;dt=0.5,,1;di=-2",
  "svelte:screen;p=sheet;dt=1e0,auto,%61uto,0.2,0.3,0.4;di=9;gr=2;dm=3;bd=4",
  "svelte:screen;p=formSheet;dt=0.2;di=4;gr=1",
  "svelte:screen;ss=x;nc=102030FF;ns=l",
  "svelte:screen;nc=12345678",
  "svelte:screen;sx=1;a=1;a=2",
  "svelte:screen;=1;p=modal;novalue;g",
  "svelte:header;l=true;tl=1;bk=01;hs=1;t=;st=%E2%9C%93;sl=x",
  "svelte:header;tc=zzzzzzzz;bg=0000000;sl= 9 ",
  "svelte:header-search;ph=;v=;ec=-3",
  "svelte:tabs;sel=-1;sc=x;lb=0;uc=00000000",
  "svelte:tab;bd=0;iv=;ds=2x;k=%E2%82%AC",
  "svelte:tab;bd=%20",
];

native("the C++ decoder reads every golden nativeID into the records the reference decoder produces", () => {
  expectSameRecords(golden, run("records", golden));
});

native("the C++ decoder agrees with the reference decoder on malformed, partial and repeated keys", () => {
  expectSameRecords(hostile, run("records", hostile));
});

native("the C++ decoder agrees with the reference decoder on every nativeID the encoders build from a grid of attributes", () => {
  const colors = [undefined, "#fff", "rgba(1, 2, 3, 0.5)", "transparent", "papayawhip"];
  const ids: string[] = [];
  const add = (name: string, attributes: Record<string, unknown>) => ids.push(String(navigationProps(name, attributes).nativeID));
  for (const stackPresentation of ["push", "modal", "transparentModal", "sheet", "formSheet", "bogus"]) {
    for (const sheetDetents of [undefined, [1], [0.3, "auto"], ["auto"], [0.25, 0.5, 0.75, 1, 0.1], [2, "x"]]) {
      for (const sheetInitialDetent of [undefined, 0.3, "auto", 1]) {
        for (const flags of [{}, { gestureEnabled: false, activityState: 1 }, { sheetGrabber: false, sheetDismissible: false, sheetBackdrop: "none" }, { sheetGrabber: true, nativeBackButtonDismissalEnabled: false, stackAnimation: "fade" }]) {
          add("native-screen", { stackPresentation, sheetDetents, sheetInitialDetent, ...flags });
        }
      }
    }
  }
  for (const statusBarStyle of [undefined, "light", "dark"]) {
    for (const navigationBarColor of colors) add("native-screen", { statusBarStyle, statusBarHidden: statusBarStyle === "dark", navigationBarColor, navigationBarStyle: statusBarStyle });
  }
  for (const title of [undefined, "Inbox", "A;B=C, 100%", "عنوان ✓"]) {
    for (const flags of [{}, { large: true, translucent: true }, { back: true, hideShadow: true, slots: 7 }, { slots: 15, backTitle: "Back", subtitle: "3 unread" }]) {
      for (const tint of colors) add("native-header", { title, tint, background: tint, ...flags });
    }
  }
  for (const name of ["native-header-left", "native-header-center", "native-header-right"]) add(name, {});
  for (const placeholder of [undefined, "Search…", "100%"]) for (const value of [undefined, "", "a b"]) for (const eventCount of [0, 3]) add("native-header-search", { placeholder, value, eventCount });
  for (const selectedIndex of [0, 2]) for (const selectCount of [0, 4]) for (const tint of colors) add("native-tabs", { selectedIndex, selectCount, tint, inactiveTint: tint, background: tint, labels: selectedIndex ? "never" : "always" });
  for (const badge of [undefined, true, 0, 7, 120, "new", ""]) for (const iconView of [false, true]) add("native-tab", { tabKey: "in/box", title: "Inbox ✓", icon: iconView ? undefined : "https://x/y.png?a=1&b=2", selectedIcon: "file:///a b.png", iconView, badge, disabled: badge === 7 });
  add("native-tab-icon", {});
  add("native-stack", {});
  expect(ids.length).toBeGreaterThan(700);
  expectSameRecords(ids, run("records", ids));
});

native("the stack planner pushes a new top, pops a top that left, and applies other changes without animation", () => {
  const cases: [string, { step: string; staged: number[] }][] = [
    ["1|1", { step: "none", staged: [] }],
    ["1,2|1,2", { step: "none", staged: [] }],
    ["1,2|", { step: "none", staged: [] }],
    ["|1,2", { step: "replace", staged: [1, 2] }],
    ["1,2|1,2,3", { step: "push", staged: [1, 2] }],
    ["1|1,2,3", { step: "push", staged: [1, 2] }],
    ["1,2,3|1,2", { step: "pop", staged: [1, 2, 3] }],
    ["1,2,3|1", { step: "pop", staged: [1, 3] }],
    ["1,2|1,3", { step: "pop", staged: [1, 3, 2] }],
    ["1,2|3,4", { step: "pop", staged: [3, 4, 2] }],
    ["1,2,3|1,2,4,5", { step: "pop", staged: [1, 2, 4, 5, 3] }],
    ["1,2,3|1,3", { step: "replace", staged: [1, 3] }],
    ["1,2|2,1", { step: "replace", staged: [2, 1] }],
    ["1,2,3|3,1,2", { step: "replace", staged: [3, 1, 2] }],
  ];
  const out = run("plan", cases.map(([input]) => input));
  for (const [index, [input, expected]] of cases.entries()) expect(JSON.parse(out[index]), input).toEqual(expected);
});

native("a sheet detent is a fraction of the space below the top inset, the content height for auto, never above what UIKit allows", () => {
  const cases: [string, number][] = [
    // available, maximum: both 800 (UIKit allows the whole container)
    ["0.5 800 800 0", 400], ["1 800 800 0", 800], ["0.25 800 800 0", 200], ["0 800 800 500", 0], ["2 800 800 0", 800],
    ["-1 800 800 300", 300], ["-1 800 800 900", 800], ["-1 800 800 -5", 0], ["0.5 0 0 0", 0], ["0.5 -20 -20 0", 0],
    // iOS 26 floating sheet on an iPhone SE 3: 647 below the top inset, 610 the largest detent UIKit resolves
    ["0.5 640 610 0", 320], ["1 640 610 0", 610], ["0.75 800 610 0", 600], ["-1 640 610 900", 610], ["-1 640 610 300", 300], ["0.5 640 0 0", 0],
  ];
  const out = run("detent", cases.map(([input]) => input));
  for (const [index, [input, expected]] of cases.entries()) expect(Number(out[index]), input).toBe(expected);
});

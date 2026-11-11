import { tick } from "svelte";
import { Appearance, Dimensions } from "@rasheed/svelte-native/platform";
import { mergeHostProps } from "@rasheed/svelte-native/renderer";
import { allSides, classCheckNames, classStyle, expectations, isColor, sentStyle, white, zinc900, type HostNode, type Outcome, type Rect, type Style } from "./class-checks.ts";

/**
 * The class checks of the native checks lab (`/__dev`, "Run all checks", after the 28 checks of Svelte itself): `class` on the views of `ClassProbe.svelte` must have become the style the CSS file says
 * (`src/global.css`, Tailwind 4.3.3), read on the device from the props of the mounted host nodes (`class-checks.ts` says which props, and what each check expects).
 *
 * `dark:` is the one that needs the system to change: the app's appearance is overridden (`Appearance.setColorScheme`, which the library documents as the override) to the scheme the device is not in,
 * the views are read when the classes have followed it, and the override is taken off again whatever happened. React Native tells the library about a change when the platform reports it, so the
 * wait is for the views to change, not for the call to return.
 */

type Measurable = { measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void };
/** What `ClassProbe.svelte` hands out. */
export type ClassProbeHandle = {
  node(name: string): unknown;
  handles(): { parent: Measurable | null; child: Measurable | null };
  setWide(next: boolean): void;
};
type Report = (name: string, passed: boolean, detail?: string) => void;

const nodeNames = ["padding", "tint", "responsive", "capped", "scheme", "custom", "beaten", "inline", "list", "object", "label"] as const;

async function until(test: () => boolean, milliseconds: number): Promise<boolean> {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) {
    if (test()) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  return test();
}

const rectOf = (handle: Measurable | null): Promise<Rect | null> =>
  new Promise<Rect | null>((resolve) => {
    if (!handle) { resolve(null); return; }
    const timer = setTimeout(resolve, 2000, null);
    handle.measureInWindow((x, y, width, height) => { clearTimeout(timer); resolve({ x, y, width, height }); });
  });

export async function runClassChecks(probe: ClassProbeHandle | undefined, report: Report): Promise<void> {
  const missing = probe ? nodeNames.filter((name) => typeof (probe.node(name) as HostNode | null | undefined)?.peekProps !== "function") : [...nodeNames];
  if (!probe || missing.length > 0) {
    // Each check still reports, so that a probe that did not mount is that many failures and not a count that quietly fell.
    for (const name of classCheckNames) report(name, false, `the probe's views are not mounted: ${missing.join(", ")}`);
    return;
  }
  const node = (name: (typeof nodeNames)[number]): HostNode => probe.node(name) as HostNode;
  // What the host sends the native view for a node: the props it builds from the node's attributes, `style` flattened.
  const read = (name: (typeof nodeNames)[number]): Style => sentStyle(mergeHostProps(node(name).peekProps()));
  const [padding, layout, tint, responsive, scheme, custom, beaten, inline, state, text] = classCheckNames;
  const outcomes = new Map<string, Outcome>();

  outcomes.set(padding, expectations.padding(read("padding")));
  const { parent, child } = probe.handles();
  outcomes.set(layout, expectations.layout(await rectOf(parent), await rectOf(child)));
  outcomes.set(tint, expectations.tint(read("tint")));
  outcomes.set(responsive, expectations.responsive(read("responsive"), read("capped"), Dimensions.get("window").width));
  outcomes.set(inline, expectations.inline(read("inline"), classStyle(node("inline"))));
  outcomes.set(text, expectations.text(read("label")));

  // A state change: the array form and the object form of `class` on views, 16 dp of padding and then 32.
  const before = { list: read("list"), object: read("object") };
  probe.setWide(true);
  await tick();
  const moved = await until(() => allSides(read("list"), "padding", 32) && allSides(read("object"), "padding", 32), 3000);
  outcomes.set(state, expectations.state(before, moved ? { list: read("list"), object: read("object") } : null));
  probe.setWide(false);

  // The scheme: the views are read under the scheme the device has, then under the other one, and the override is taken off.
  const original = Appearance.getColorScheme() === "dark" ? "dark" : "light";
  const opposite = original === "dark" ? "light" : "dark";
  const schemeViews = () => ({ scheme: read("scheme"), custom: read("custom"), beaten: read("beaten") });
  const underOriginal = schemeViews();
  let underOpposite: ReturnType<typeof schemeViews>;
  let restored: boolean;
  try {
    Appearance.setColorScheme(opposite);
    const wanted = opposite === "dark" ? zinc900 : white;
    await until(() => isColor(read("scheme").backgroundColor, wanted, 1) && isColor(read("custom").backgroundColor, wanted, 1), 5000);
    underOpposite = schemeViews();
  } finally {
    Appearance.setColorScheme("unspecified");
    restored = await until(() => isColor(read("scheme").backgroundColor, original === "dark" ? zinc900 : white, 1), 5000);
  }
  const [light, dark] = original === "light" ? [underOriginal, underOpposite] : [underOpposite, underOriginal];
  const switched = expectations.scheme(light.scheme, dark.scheme);
  outcomes.set(scheme, restored ? switched : { passed: false, detail: [switched.detail, `the app did not come back to the ${original} scheme`].filter(Boolean).join("; ") });
  outcomes.set(custom, expectations.custom(light.custom, dark.custom));
  // The utility next to the class wins the padding, whatever the scheme.
  outcomes.set(beaten, expectations.beaten(underOriginal.beaten));

  for (const name of classCheckNames) {
    const outcome = outcomes.get(name);
    report(name, outcome?.passed === true, outcome?.detail ?? "the check did not run");
  }
}

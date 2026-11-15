import { expect, test } from "bun:test";
import { compile } from "svelte/compiler";
import { lowerPrimitives } from "../../src/lower.ts";

/** The `gesture` attribute and the `use:gesture` action through the lowering of the primitives to host tags (`src/lower.ts`); what they do on the host is in `tests/gestures/primitives.test.ts`. */
test("lowering keeps `use:gesture` quiet, and still warns about other actions and about a gesture import from elsewhere", () => {
  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(message);
  const imports = `<script>\n  import { View, gesture } from "@alfayez/svelte-native";\n  import { tap } from "./actions";\n</script>\n`;
  const out = lowerPrimitives(`${imports}<View use:gesture={pan}>a</View><View use:tap>b</View>`, { filename: "a.svelte", warn });
  expect(out).toContain("<native-view use:gesture={pan}>a</native-view>");
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("use:tap");

  warnings.length = 0;
  const other = `<script>\n  import { View } from "@alfayez/svelte-native";\n  import { gesture } from "./mine";\n</script>\n<View use:gesture={pan}>a</View>`;
  lowerPrimitives(other, { filename: "b.svelte", warn });
  expect(warnings).toHaveLength(1);

  // An alias is still the action.
  warnings.length = 0;
  lowerPrimitives(`<script>\n  import { View, gesture as drag } from "@alfayez/svelte-native";\n</script>\n<View use:drag={pan}>a</View>`, { filename: "c.svelte", warn });
  expect(warnings).toEqual([]);
});

test("the lowered and the component form of a primitive compile to the same host tag with the attribute", () => {
  const source = `<script>\n  import { View } from "@alfayez/svelte-native";\n  let { pan } = $props();\n</script>\n<View gesture={pan} />`;
  const code = compile(lowerPrimitives(source), { filename: "f.svelte", generate: "client", runes: true, experimental: { customRenderer: "@alfayez/svelte-native/renderer" } }).js.code;
  expect(code).toContain("native-view");
  expect(code).toContain("'gesture'");
});

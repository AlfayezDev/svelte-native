import { expect, test } from "bun:test";
import { compile } from "svelte/compiler";
import { lowerPrimitives } from "../../src/lower.ts";

/** The `gesture` attribute and the `use:gesture` action through the lowering of the primitives to host tags (`src/lower.ts`); what they do on the host is in `tests/gestures/primitives.test.ts`, and the warnings about `use:gesture` are `lower.test.ts`'s. */
test("the lowered and the component form of a primitive compile to the same host tag with the attribute", () => {
  const source = `<script>\n  import { View } from "@alfayez/svelte-native";\n  let { pan } = $props();\n</script>\n<View gesture={pan} />`;
  const code = compile(lowerPrimitives(source), { filename: "f.svelte", generate: "client", runes: true, experimental: { customRenderer: "@alfayez/svelte-native/renderer" } }).js.code;
  expect(code).toContain("native-view");
  expect(code).toContain("'gesture'");
});

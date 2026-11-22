import { expect, test } from "bun:test";
import { compile } from "svelte/compiler";
import { componentOptions } from "../../src/compile-options.ts";

/**
 * Svelte's compiler refuses the transition directives on an element of a custom renderer, and this repository's Svelte has the refusals patched out for Bun, which runs no Node hooks
 * (`patches/svelte@*.patch`); an app's transformer does it as it loads the compiler. The test pins the patch: a Svelte update that drops or moves it fails here and not in the animation tests.
 */
test("a custom renderer's compiler takes every one of the directives", () => {
  for (const directive of ["in:fade", "out:fade", "transition:fade", "animate:flip"]) {
    const each = directive.startsWith("animate") ? "{#each [1] as item (item)}<native-view animate:flip>{item}</native-view>{/each}" : `<native-view ${directive}></native-view>`;
    expect(() => compile(`<script>\n  import { fade } from "svelte/transition";\n  import { flip } from "svelte/animate";\n</script>\n${each}`, componentOptions("directive.svelte")), directive).not.toThrow();
  }
});

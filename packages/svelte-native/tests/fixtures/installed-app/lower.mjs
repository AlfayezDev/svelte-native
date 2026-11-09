// Run by plain `node`: the entries that are plain imports.
import * as routes from "@rasheed/svelte-native/routes";
import { lowerPrimitives } from "@rasheed/svelte-native/lower";

const lowered = lowerPrimitives('<script lang="ts">import { View } from "@rasheed/svelte-native";</script>\n<View />\n', { filename: "a.svelte" });
console.log(JSON.stringify({ routes: Object.keys(routes), lowered }));

// Run by plain `node`: the entries that are plain imports.
import * as routes from "expo-svelte/routes";
import { lowerPrimitives } from "expo-svelte/lower";

const lowered = lowerPrimitives('<script lang="ts">import { View } from "expo-svelte";</script>\n<View />\n', { filename: "a.svelte" });
console.log(JSON.stringify({ routes: Object.keys(routes), lowered }));

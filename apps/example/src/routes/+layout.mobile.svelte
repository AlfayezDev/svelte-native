<script lang="ts">
  import type { Snippet } from "svelte";
  import { Stack } from "@rasheed/svelte-native";
  import { theme } from "#lib/theme.svelte.ts";
  // `class` on every component: Uniwind's styles for the classes, compiled from src/global.css.
  import "@rasheed/svelte-native/uniwind";
  import "../global.css";

  // The app shell. `children` is the root navigator: a stack with one screen per page of `src/routes`, the home screen first. The options on
  // `<Stack>` are defaults for every screen of the stack; a screen's own `<Screen>` wins. The colours follow the system's light or dark mode,
  // and the status bar follows it too (`"auto"`).
  let { children }: { children: Snippet } = $props();
</script>

<Stack statusBar={{ style: "auto" }} style={{ backgroundColor: theme.colors.background }}>
  {@render children()}
</Stack>

/**
 * Loads the push client when the build has push: the native module `SveltePush` is present (`@alfayez/svelte-native-push` is installed, `capabilities.push` is on), or the app's
 * hooks have `push` (`src/hooks.mobile.ts` exports it). The client starts when its module is evaluated (`push.svelte.ts`), and it must be there before the router reads the launch
 * link, and in a launch without a screen (a background message), whatever the app imports: a tapped notification opens its link in every app that has push (PUSH.md, rule 1).
 * Like `remote/config.ts` it watches the hooks (`watchHooks`), and `app.ts` imports it, so the generated `.svelte-native/hooks.ts` needs no knowledge of push.
 *
 * An app without the native module and without `push` hooks pays for one registry lookup: it requires nothing of the client and wraps nothing.
 */
import { watchHooks } from "../app-hooks.ts";

let present: boolean | undefined;
let loaded = false;

/** Whether the build has the native module `SveltePush`: looked up once, as the client looks it up when it loads (`loadNativePush`). */
function hasNativePush(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- required on the first lookup
  const registry = require("expo-modules-core") as Partial<typeof import("expo-modules-core")>;
  present ??= (registry.requireOptionalNativeModule?.("SveltePush") ?? null) !== null;
  return present;
}

watchHooks((hooks) => {
  if (loaded || (hooks.push === undefined && !hasNativePush())) return;
  loaded = true;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- required once the build has push: an app without it evaluates none of the client
  require("./push.svelte.ts");
});

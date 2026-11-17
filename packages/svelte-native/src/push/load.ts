/**
 * Loads the push client when the app's hooks have `push` (`src/hooks.mobile.ts` exports it): the client starts when its module is evaluated (`push.svelte.ts`), so a launch without a
 * screen, a background message, reaches the hooks without any screen having imported `push`. Like `remote/config.ts` it watches the hooks (`watchHooks`), and `app.ts` imports it, so
 * the generated `.svelte-native/hooks.ts` that registers them needs no knowledge of push; an app without `push` hooks never evaluates the client.
 */
import { watchHooks } from "../app-hooks.ts";

watchHooks((hooks) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- required once the app has push hooks: an app without them evaluates none of the client
  if (hooks.push !== undefined) require("./push.svelte.ts");
});

// The ambient declarations of the SvelteKit files this module imports (a script file of `declare module`s: it cannot be imported).
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./kit-modules.d.ts" />
/**
 * The module the client stubs of a `*.remote.ts` file call (`__remote.query("<hash>/<name>")`), in the place of SvelteKit's
 * `client/remote-functions/index.js`: the same six functions. `query`, `query_batch`, `query_live`, `command` and `prerender` are SvelteKit's own
 * files; `form` is the native one (`form.svelte.ts`). Each remote function fails when it is called, not when the module is imported, if the
 * app has no host (`RemoteConfigError`) or the JavaScript environment lacks what the client needs.
 */
import { command as kitCommand } from "@sveltejs/kit/src/runtime/client/remote-functions/command.svelte.js";
import { prerender as kitPrerender } from "@sveltejs/kit/src/runtime/client/remote-functions/prerender.svelte.js";
import { query as kitQuery } from "@sveltejs/kit/src/runtime/client/remote-functions/query/index.js";
import { query_batch as kitQueryBatch } from "@sveltejs/kit/src/runtime/client/remote-functions/query-batch.svelte.js";
import { query_live as kitQueryLive } from "@sveltejs/kit/src/runtime/client/remote-functions/query-live/index.js";
import { form as nativeForm } from "./form.svelte.ts";
import { ownedQuery } from "./owned.svelte.ts";
import { assertReady } from "./ready.ts";

export { assertReady };

/**
 * The remote function as it is, with every call checked first and, for a query, the object it returns freed with the effect that made it (`owned.svelte.ts`).
 * A proxy keeps what SvelteKit hangs on the function (`pending`, the id `updates()` reads).
 */
function guarded<T extends (...args: never[]) => unknown>(remote: T, owned = false): T {
  return new Proxy(remote, {
    apply(target, thisArg, args) {
      assertReady();
      return owned ? ownedQuery(() => Reflect.apply(target, thisArg, args) as object) : Reflect.apply(target, thisArg, args);
    },
  });
}

export const query = (id: string) => guarded(kitQuery(id), true);
export const query_batch = (id: string) => guarded(kitQueryBatch(id), true);
export const query_live = (id: string) => guarded(kitQueryLive(id), true);
export const command = (id: string) => guarded(kitCommand(id));
export const prerender = (id: string) => guarded(kitPrerender(id));
export const form = nativeForm;

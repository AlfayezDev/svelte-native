/**
 * Where `@sveltejs/kit` is, and what to say when it is not there. SvelteKit is an optional peer dependency: remote functions (its client runtime is reused
 * as it is) and the web target of the Vite plugin need it, a native-only app does not. Pure Node, and nothing else of the Node side imports SvelteKit,
 * so every other entry of the package loads without it.
 */
import { createRequire } from "node:module";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);

let kitRootCache: string | null | undefined;
/** The directory of the installed `@sveltejs/kit` package, or `null` when the app has none. The answer is kept: every module Metro resolves asks. */
export function findKitRoot(): string | null {
  if (kitRootCache === undefined) {
    try {
      kitRootCache = dirname(require.resolve("@sveltejs/kit/package.json"));
    } catch {
      kitRootCache = null;
    }
  }
  return kitRootCache;
}

/** What a feature that needs `@sveltejs/kit` says when the app has not installed it. `what` is the feature, as the subject of the sentence. */
export function kitMissingMessage(what: string): string {
  return `${what} needs \`@sveltejs/kit\`, which is not installed (an optional peer dependency of expo-svelte: only remote functions and the web target use it). Install the version the package was written against: \`pnpm add @sveltejs/kit@3.4.0\`, and copy its patch (README, "Apply the patches").`;
}

/** The directory of the installed `@sveltejs/kit` package; throws, naming the package, when it is not installed. */
export function kitRoot(what = "The remote function runtime (`expo-svelte/remote`)"): string {
  const found = findKitRoot();
  if (found === null) throw new Error(kitMissingMessage(what));
  return found;
}

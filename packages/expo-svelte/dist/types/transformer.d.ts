/**
 * `@expo/metro-config/babel-transformer`, which this transformer wraps. `@expo/metro-config` is a dependency of `expo`, and of neither the app nor
 * this package, so it is found through `expo`, as `expo/metro-config` finds it: `expo` is a required peer, which both the app and this package see in
 * any layout. A hoisted install has `@expo/metro-config` at the top of `node_modules`; pnpm's default layout has it only beside `expo`'s own copy,
 * where a plain `require` from here (or from the app) cannot reach it. The app's directory is asked first (Metro runs there), then this package's.
 */
export declare function upstreamTransformerPath(searchFrom?: readonly string[]): string;
type TransformInput = {
    filename: string;
    src: string;
    options: {
        dev: boolean;
        projectRoot?: string;
    };
    [key: string]: unknown;
};
/**
 * The source the rest of the transform works on. A `*.remote.ts` module (it imports `$app/server` and the app's server code) is replaced by the client
 * stubs SvelteKit's Vite plugin would generate, and the SvelteKit client files that run remote functions get the globals a browser would (an import at
 * the end of the file, so no line moves).
 */
export declare function sourceOf(input: TransformInput): string;
export declare function transform(input: TransformInput): any;
/**
 * Metro's cache key for what this transformer produces: the code that runs, the app's `runes` and `async` settings, and upstream's key. Built (`dist/node/transformer.cjs`), the one file
 * holds the modules it imports; run from the sources, those that make the output (`cacheKeyFiles`: `lower.ts` and what it imports, `remote/transform.ts`, `compile-options.ts`) are hashed next to this one.
 */
export declare function getCacheKey(options?: unknown): string;
export {};

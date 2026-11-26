/** Primitive components that are plain wrappers around one host tag. */
export declare const LOWERED_TAGS: Record<string, string>;
export type LowerOptions = {
    filename?: string;
    warn?: (message: string) => void;
    /**
     * Also lower the HTML elements of the file (`<div>`, `<p>`, `<button>`, `<a href>`, `<img>`, `<input>`, ...) to native ones (`lower-html.ts`), and fail on an HTML element with no native
     * equivalent. Off by default: the Metro transformer asks for it for the app's own files, and the preprocessor (`lower`, which svelte-check and a `svelte.config.js` may load, and so a
     * web build) never does, since a file must still mean HTML there.
     */
    html?: boolean;
};
/**
 * Rewrites `<View>`, `<Text>`, ... imported from "expo-svelte" into their host tags.
 * Only the tag names change: everything else is carried over verbatim, so line numbers are
 * stable (columns shift on lines holding a lowered tag, and no source map is produced: [lowerWithMap] has the way back for one position).
 */
export declare function lowerPrimitives(content: string, options?: LowerOptions): string;
/** The lowered text of a file, and where a position of it is in the file the developer wrote ([lowerWithMap]). `line` is 1-based and `column` 0-based, as Svelte's errors have them. */
export type Lowering = {
    code: string;
    original(line: number, column: number): {
        line: number;
        column: number;
    };
};
/**
 * [lowerPrimitives] with the way back: `original` takes a position in the lowered text (where Svelte reports an error, on the lowered tag's name and the `nativeClass={...}` that took the
 * place of a `class`) to the position of the same place in `content`. A position inside what an edit wrote is the start of what the edit replaced.
 */
export declare function lowerWithMap(content: string, options?: LowerOptions): Lowering;
/** Standard Svelte preprocessor wrapper, for svelte-check and other Svelte tooling. */
export declare const lower: {
    name: string;
    markup({ content, filename }: {
        content: string;
        filename?: string;
    }): {
        code: string;
    } | undefined;
};
export default lower;

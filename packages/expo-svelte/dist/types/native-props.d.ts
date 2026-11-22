/**
 * One resolver per component instance; call it with the component's attributes on every update, in the component's template (the
 * style of `class` is worked out here, so what the class resolver reads is tracked by the template: see `classes.ts`).
 */
export declare function createNativeProps(): (attributes: object) => Record<string, unknown>;
/**
 * The React Native props of a host element: the legacy `nativeProps` object overlaid with every other attribute
 * (Svelte internals, `class`, `id`, `data-*` and `children` are not React Native props; the style of `class` comes as `nativeClass`).
 * `ref` stays in the result for the host to peel off. Svelte stringifies a `style` attribute on every element,
 * so a string `style` is dropped and `nativeStyle` carries a style object for the lowering preprocessor. The markers of a lowered HTML element (`nativeHtml`, `nativeForm`, `lower-html.ts`)
 * are the host's and the renderer's to read, and `nativeBase` is a style under the element's class and style (the default of an `hr`).
 */
export declare function mergeHostProps(attributes: Readonly<Record<string, unknown>>): Record<string, unknown>;

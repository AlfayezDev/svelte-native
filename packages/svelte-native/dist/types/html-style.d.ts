/**
 * The small run-time parser of the style an HTML element gets as `style:property={value}` directives (`hostStyleProps`) or as a string that is only known when the app runs
 * (`style={text}`, `styleText`): the name is camel-cased, `px` and a plain number are dp, `rem` is 16 dp, a percentage, a color or a keyword passes as it is, and a unitless
 * `line-height` and an `em` `line-height` or `letter-spacing` are a factor of the font size (`fontRelative`, `fabric/text-inherit.ts`). A string that is written in the source is
 * converted when the file is built, by the converter of the classes (`css/inline.ts`), which this module does not need and the app does not carry.
 */
/** The style of the `style:property={value}` directives of an element, as a React Native style object. `null`, `undefined` and `false` take the property away, as they do on the web. */
export declare function hostStyleProps(props: Record<string, unknown>): Record<string, unknown>;
/** The style of a CSS declaration list known only when the app runs (`padding: 4px; color: red !important`): the same values as the directives take. */
export declare function styleText(text: string): Record<string, unknown>;

/**
 * The hook for foreign libraries whose text is not React Native's text (react-native-svg: SPEC.md, "react-native-svg"). In React Native a
 * string between the tags of a `Text` is a raw-text child. In react-native-svg it is a `TSpan`: the string of a `TSpan` is its `content`
 * prop, and a string next to other children (or directly in a `Text` or `TextPath`) is a `TSpan` of its own. The library's components
 * work that out from their React children; a Svelte component sees none, so the host (`fabric/host.ts`) does it when it builds the node,
 * for the Fabric names the library says are text components. Nothing is registered until the library's entry is imported.
 */
export type ForeignText = {
  /**
   * What a Fabric component does with the text between its tags: `container` makes every string a span of its own, `span` takes a lone
   * string as its `content` prop (and makes spans of strings among other children); null is not a text component.
   */
  mode(viewName: string): "container" | "span" | null;
  /** The Fabric component and props a string becomes where it is a span of its own. */
  span(content: string): { viewName: string; props: Record<string, unknown> };
};

export const foreignText: { handler: ForeignText | null } = { handler: null };

export function setForeignText(handler: ForeignText | null): void {
  foreignText.handler = handler;
}

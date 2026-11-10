// The two modules of Uniwind's runtime `uniwind.ts` reads, as far as it uses them (uniwind 1.13.2: `src/core/native/store.ts`,
// `src/core/listener.ts`). They are not in Uniwind's package exports, so TypeScript cannot resolve them from its package.

declare module "uniwind/src/core/native" {
  export const UniwindStore: {
    getStyles(
      className: string | undefined,
      componentProps: Record<string, unknown> | undefined,
      state: { isDisabled?: boolean; isFocused?: boolean; isPressed?: boolean } | undefined,
      context: { scopedTheme: string | null; rtl: boolean | null; variables: Record<string, unknown> | null },
    ): { styles: Record<string, unknown>; dependencies: number[]; dependencySum: number };
  };
}

declare module "uniwind/src/core/listener" {
  export const UniwindListener: {
    subscribe(listener: () => void, dependencies: number[], options?: { once?: boolean }): () => void;
  };
}

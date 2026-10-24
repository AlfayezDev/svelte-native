import "svelte/elements";

declare module "svelte/elements" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Must match Svelte's interface parameters.
  interface HTMLAttributes<T> { nativeProps?: object; }
}

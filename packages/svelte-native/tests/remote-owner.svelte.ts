// Runs `make` inside an effect root, as a component's script does, and says when to tear it down.
export function inOwner<T>(make: () => T): { value: T; destroy(): void } {
  let value!: T;
  const destroy = $effect.root(() => { value = make(); });
  return { value, destroy };
}

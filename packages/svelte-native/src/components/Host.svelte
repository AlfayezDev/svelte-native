<script module lang="ts">
function plainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype && !("_isReanimatedSharedValue" in value);
}

function retainStyle(value: unknown, previous: unknown): unknown {
  if (Array.isArray(value)) {
    const old: unknown[] = Array.isArray(previous) ? previous : [];
    const next = value.map((item: unknown, index) => retainStyle(item, old[index]));
    return Array.isArray(previous) && next.length === old.length && next.every((item, index) => Object.is(item, old[index])) ? previous : next;
  }
  if (plainRecord(value)) {
    const old = plainRecord(previous) ? previous : {};
    const next = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, retainStyle(item, old[key])]));
    return plainRecord(previous) && Object.keys(next).length === Object.keys(old).length && Object.keys(next).every((key) => Object.is(next[key], old[key])) ? previous : next;
  }
  return value;
}

function retainNativeProps(value: Record<string, unknown>, previous: Record<string, unknown> | undefined): Record<string, unknown> {
  const old = previous ?? {};
  const next = { ...value };
  if ("style" in next) next.style = retainStyle(next.style, old.style);
  return previous && Object.keys(next).length === Object.keys(old).length && Object.keys(next).every((key) => Object.is(next[key], old[key])) ? previous : next;
}

function createNativeProps() {
  let previous: Record<string, unknown> | undefined;
  return (attributes: object) => {
    previous = retainNativeProps({ ...attributes }, previous);
    return previous;
  };
}
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  let { name, attributes = {}, children }: {
    name: string;
    attributes?: object;
    children?: Snippet;
  } = $props();
  const resolveProps = createNativeProps();
  const nativeProps = $derived(resolveProps(attributes));
</script>

<svelte:element this={name} {nativeProps}>{@render children?.()}</svelte:element>

<script lang="ts">
  import { getContext } from "svelte";
  import { Text, View } from "@alfayez/svelte-native";
  import { labContext, type LabContext } from "./model.svelte.ts";
  import { theme } from "../state.svelte.ts";
  import Field from "./Field.svelte";
  import Button from "../components/Button.svelte";
  let { value = $bindable(""), label, observe }: {
    value?: string; label: string; observe: (value: { value: string; label: string; context: string }) => void;
  } = $props();
  const context = getContext<LabContext>(labContext);
  $effect(() => observe({ value, label, context: context.message }));
  export function setValue(next: string) { value = next; }
  export function readValue() { return value; }
</script>
<View style={{ gap: 10 }}>
  <Text style={{ color: theme.muted }}>Child prop: {label}; context: {context.message}</Text>
  <Field label="Bound child input" bind:value />
  <Button label="Change from child" variant="secondary" onPress={() => { value = `${value}!`; }} />
</View>

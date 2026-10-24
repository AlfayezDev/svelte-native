<script module lang="ts">
  let nextInstance = 0;
  function nextId() { nextInstance++; return nextInstance; }
</script>
<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { Text, View } from "@rasheed/svelte-native";
  import type { RowHandle } from "./model.svelte.ts";
  import { theme } from "../state.svelte.ts";
  import Field from "../components/Field.svelte";
  import Button from "../components/Button.svelte";
  let { row, register, remove }: {
    row: { id: string; name: string }; register: (id: string, handle: RowHandle) => void; remove: (id: string) => void;
  } = $props();
  const id = untrack(() => row.id);
  const instance = nextId();
  let draft = $state(untrack(() => row.name));
  let taps = $state(0);
  onMount(() => {
    register(id, { draft: () => draft, setDraft: (value) => { draft = value; } });
    return () => remove(id);
  });
</script>
<View style={{ gap: 8, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 12 }}>
  <Text style={{ color: theme.foreground }}>{row.name} · instance {instance} · taps {taps}</Text>
  <Field label={`Draft ${id}`} bind:value={draft} />
  <Button label={`Tap ${id}`} variant="secondary" onPress={() => { taps++; }} />
</View>

<script lang="ts">
  // Keyboard.dismiss() and the focused TextInput (#110): the page calls React Native's own `dismissKeyboard`, which is what `Keyboard.dismiss()` runs.
  import { TextInput } from "expo-svelte/core";
  import dismissKeyboard from "react-native/Libraries/Utilities/dismissKeyboard";
  const probe = globalThis as unknown as { __htmlLog: (entry: string) => void; __events: Record<string, unknown> };
  const log = (entry: string) => probe.__htmlLog(entry);
  let shown = $state(true);
  let given: unknown = null;
  probe.__events = { dismiss: () => dismissKeyboard(), hide: () => { shown = false; }, given: () => given };
</script>

<TextInput testID="name" ref={(instance) => { given = instance; }} onFocus={() => log("name focus")} onBlur={() => log("name blur")} />
<TextInput testID="other" />
{#if shown}<TextInput testID="gone" />{/if}

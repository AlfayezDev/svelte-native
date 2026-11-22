<script lang="ts">
  // A raw onChange next to the conveniences and the binding (#91), and a declarative selection (#90).
  import { Switch, TextInput } from "@alfayez/svelte-native/core";
  const probe = globalThis as unknown as { __htmlLog: (entry: string) => void; __changes: Record<string, unknown> };
  const log = (entry: string) => probe.__htmlLog(entry);
  let value = $state("abcdefgh");
  let enabled = $state(false);
  let range = $state({ start: 1, end: 3 });
  probe.__changes = { value: () => value, enabled: () => enabled, setRange: (start: number, end: number) => { range = { start, end }; } };
</script>

<TextInput testID="both" bind:value onChange={(event) => log(`raw ${event.nativeEvent.text} ${event.nativeEvent.eventCount}`)} onChangeText={(text) => log(`text ${text}`)} />
<TextInput testID="mirror" {value} editable={false} />
<Switch testID="switch" bind:value={enabled} onChange={(event) => log(`raw ${event.nativeEvent.value}`)} onValueChange={(next) => log(`value ${next}`)} />
<TextInput testID="caret" value="abcdefgh" selection={range} />
<TextInput testID="caret-multiline" multiline value="abcdefgh" {...{ selection: range }} />

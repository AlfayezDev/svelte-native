<script lang="ts">
  // onContentSizeChange and onScroll on a TextInput and on a textarea (#89): the props the host gives the native view for a handler, and what the handler hears.
  import { TextInput } from "expo-svelte/core";
  const probe = globalThis as unknown as { __htmlLog: (entry: string) => void; __events: Record<string, unknown> };
  const log = (entry: string) => probe.__htmlLog(entry);
  let watched = $state(true);
  probe.__events = { unwatch: () => { watched = false; } };
</script>

<TextInput testID="field" multiline onContentSizeChange={(event) => log(`size ${event.nativeEvent.contentSize.width} ${event.nativeEvent.contentSize.height}`)} onScroll={(event) => log(`scroll ${event.nativeEvent.contentOffset.y}`)} />
<TextInput testID="plain" multiline />
<TextInput testID="dropped" multiline onContentSizeChange={watched ? () => log("dropped size") : undefined} onScroll={watched ? () => log("dropped scroll") : undefined} />
<textarea testID="area" onContentSizeChange={(event) => log(`area size ${event.nativeEvent.contentSize.height}`)} onScroll={(event) => log(`area scroll ${event.nativeEvent.contentOffset.y}`)}></textarea>

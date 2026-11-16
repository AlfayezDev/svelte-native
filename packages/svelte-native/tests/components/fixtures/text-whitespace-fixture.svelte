<script lang="ts">
  import { Text } from "@alfayez/svelte-native";
  import TextComponent from "../../../src/components/Text.svelte";
  let name = $state("Ada");
  export function rename(next: string) { name = next; }
</script>

<!-- Written across source lines on purpose: `Text` keeps the whitespace it is given (React Native's behaviour), so these sentences reach the native text with their line breaks and indents. -->
<Text>
  A sentence that is split
    across two source lines.
</Text>
<TextComponent>
  The same through
    the component.
</TextComponent>
<Text>
  Hello {name},
    welcome   back.
</Text>
<!-- eslint-disable-next-line svelte/no-useless-mustaches -- the recommended way to write a long sentence in a Text -->
<Text>{"one long string"}</Text>
<Text>   padded on one line   </Text>
<Text>
  Before <Text>nested</Text>
  after.
</Text>
<!-- eslint-disable-next-line svelte/no-useless-mustaches -- the other way to wrap a long sentence in the source without a line break in the text -->
<Text>{"A long sentence written "
  + "over two source lines."}</Text>

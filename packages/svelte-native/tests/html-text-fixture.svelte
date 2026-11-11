<script lang="ts">
  import { Text } from "@rasheed/svelte-native";
  let name = $state("Ada");
  export function rename(next: string) { name = next; }
</script>

<!-- Each text of a div is written as the same one of a Text, a few lines below it. -->
<div>
  A sentence that is split
    across two source lines.
</div>
<Text>
  A sentence that is split
    across two source lines.
</Text>
<div>
  Hello {name},
    welcome   back.
</div>
<Text>
  Hello {name},
    welcome   back.
</Text>
<div>
  Before <b>nested</b>
  after.
</div>
<Text>
  Before <Text>nested</Text>
  after.
</Text>
<div>   padded on one line   </div>
<Text>   padded on one line   </Text>
<div>{name}</div>
<Text>{name}</Text>
<pre>
  line one
    <b>bold</b>  and  `ticks` \ back
</pre>
<p>a<br>b</p>
<hr testID="rule" />
<hr testID="rule-own" style={{ height: 4, marginVertical: 0 }} />

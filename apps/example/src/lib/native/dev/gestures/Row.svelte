<script lang="ts">
  import { ScrollView, Text, View } from "@rasheed/svelte-native";
  import { theme } from "../../state.svelte.ts";
  import SwipeRow from "./SwipeRow.svelte";
  import type { Probe, Session } from "../gestures-lab.ts";

  /**
   * `gestures-row`: 20 swipe-to-delete rows in a vertical ScrollView. Row 3 is swiped left (it is removed, the list stays), row 5 is
   * dragged up (its pan fails, the list scrolls).
   */
  let { session, probe }: { session: Session; probe: Probe } = $props();
  const ids = Array.from({ length: 20 }, (_, index) => index + 1);
  let removed = $state<number[]>([]);
  const visible = $derived(ids.filter((id) => !removed.includes(id)));

  function remove(id: number) {
    removed = [...removed, id];
    session.mark(`removed.${id}`, 1);
    session.mark("removedTotal", removed.length);
  }
  // svelte-ignore state_referenced_locally
  session.mark("scrollY", 0);
</script>

<View style={{ gap: 8, padding: 16 }}>
  <Text style={{ color: theme.foreground, fontSize: 15 }}>Swipe a row left to delete it; drag up to scroll</Text>
  <ScrollView ref={probe("list").ref} testID={probe("list").testID} collapsable={false} scrollEventThrottle={16} onScroll={(event) => { session.mark("scrollY", event.nativeEvent.contentOffset.y); }}
    style={{ height: 420, borderRadius: 12, borderWidth: 1, borderColor: theme.border }} contentContainerStyle={{ padding: 8 }}>
    {#each visible as id (id)}
      <SwipeRow {id} {session} {probe} aimed={id === 3 || id === 5} {remove} />
    {/each}
  </ScrollView>
</View>

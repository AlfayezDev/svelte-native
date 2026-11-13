<script lang="ts">
  import { SafeAreaView, Screen, Text, View } from "@alfayez/svelte-native";
  import { text } from "#lib/theme.svelte.ts";

  // A screen pushed inside the Feed tab: the tab bar stays, and the back arrow pops back to the feed.
  let { params }: { params: { id: string } } = $props();
</script>

<Screen title={`Post ${params.id}`}>
  <SafeAreaView edges={["left", "right"]} style={{ flex: 1 }}>
    <View style={{ padding: 20, gap: 12 }}>
      <Text style={text.heading}>Post {params.id}</Text>
      <Text style={text.body}>The tab bar is still there: this screen belongs to the Feed tab's own stack.</Text>
    </View>
  </SafeAreaView>
</Screen>

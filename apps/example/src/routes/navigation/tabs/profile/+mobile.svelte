<script lang="ts">
  import { SafeAreaView, Screen, Text, View } from "@alfayez/svelte-native";
  import { text } from "#lib/theme.svelte.ts";

  // The second tab, with a plain title.
</script>

<Screen title="Profile" subtitle="Second tab">
  <SafeAreaView edges={["left", "right"]} style={{ flex: 1 }}>
    <View style={{ padding: 20, gap: 12 }}>
      <Text style={text.heading}>Profile</Text>
      <Text style={text.body}>Go back to Feed and the post you opened is still open.</Text>
    </View>
  </SafeAreaView>
</Screen>

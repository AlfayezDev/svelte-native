<script lang="ts">
  import { Text, View, useRouter } from "@rasheed/svelte-native";
  import { nativeLabEnabled, theme } from "#lib/native/state.svelte.ts";
  import Page from "#lib/native/components/Page.svelte";
  const router = useRouter();
  const rows = Array.from({ length: 60 }, (_, index) => index + 1);
</script>

{#if nativeLabEnabled}
<Page title="Lab screen" description="Pushed and popped by the navigation stress scenario." back={() => router.back()}>
  {#each rows as row (row)}
    <View style={{ padding: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface }}>
      <Text style={{ color: theme.foreground, fontSize: 15 }}>Row {row}</Text>
    </View>
  {/each}
</Page>
{/if}

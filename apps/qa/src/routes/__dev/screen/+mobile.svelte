<script lang="ts">
  import { Pressable, SafeAreaView, ScrollView, Text, View, useRouter } from "@example/svelte-native";
  import { nativeLabEnabled, t, theme } from "#lib/native/state.svelte.ts";
  import Page from "#lib/native/components/Page.svelte";
  import { screenLab } from "#lib/native/dev/model.svelte.ts";

  /**
   * The screen of the navigation stress scenario. `?header=none` is the bare one that navigation-8 pushes: no native header, a
   * title and a back link drawn in the page, so that the scenario measures the stack alone. Without it the screen is a `Page`, whose
   * title is the native header's (the parity suite's `lab-screen`).
   */
  let { url }: { url?: URL } = $props();
  const bare = $derived(url?.searchParams.get("header") === "none");
  const router = useRouter();
  const rows = Array.from({ length: 60 }, (_, index) => index + 1);
</script>

{#snippet content()}
  {#each rows as row (row)}
    <View style={{ padding: 12, borderRadius: 10, borderWidth: screenLab.rows === "plain" ? 0 : 1, overflow: screenLab.rows === "image" ? "visible" : "hidden", borderColor: theme.border, backgroundColor: theme.surface }}>
      <Text style={{ color: theme.foreground, fontSize: 15 }}>Row {row}</Text>
    </View>
  {/each}
{/snippet}

{#if nativeLabEnabled}
  {#if bare}
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, padding: 24, gap: 24, direction: theme.direction }}>
        <View style={{ gap: 12 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("common.back")} onPress={() => router.back()} hitSlop={12}><Text style={{ color: theme.foreground, fontSize: 16 }}>{t("common.back")}</Text></Pressable>
          <Text accessibilityRole="header" style={{ color: theme.foreground, fontSize: 30, fontWeight: "600", writingDirection: theme.direction }}>Lab screen</Text>
          <Text style={{ color: theme.muted, fontSize: 16, writingDirection: theme.direction }}>Pushed and popped by the navigation stress scenario.</Text>
        </View>
        {@render content()}
      </ScrollView>
    </SafeAreaView>
  {:else}
    <Page title="Lab screen" description="Pushed and popped by the navigation stress scenario.">
      {@render content()}
    </Page>
  {/if}
{/if}

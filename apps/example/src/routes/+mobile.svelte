<script lang="ts">
  import { SafeAreaView, Screen, ScrollView, Text, View, useRouter } from "@alfayez/svelte-native";
  import FeatureRow from "#lib/components/FeatureRow.svelte";
  import { coreFeatures } from "#lib/features/core.ts";
  import { groups, type Feature } from "#lib/features/feature.ts";
  import { nativeFeatures } from "#lib/features/native.ts";
  import { text, theme } from "#lib/theme.svelte.ts";

  // The home screen (the route "/"): every feature of the app, grouped, each row a link to its screen. The list comes from two registries,
  // `features/core.ts` and `features/native.ts`; a feature is a folder in `src/routes` plus one entry in one of them. `router.goto` opens a route.
  const router = useRouter();
  const features: Feature[] = [...coreFeatures, ...nativeFeatures];
  const sections = groups
    .map((group) => ({ group, features: features.filter((feature) => feature.group === group) }))
    .filter((section) => section.features.length > 0);
</script>

<Screen title="Svelte Native" header={{ large: true }}>
  <SafeAreaView edges={["left", "right", "bottom"]} style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={{ padding: 20, gap: 24 }}>
      <Text style={text.body}>
        {"Svelte components that run as real Android and iOS views, with no WebView and no React. Each row below is one feature: open it to " +
          "read a few sentences about it and use a live example. The code of every screen is one short file in src/routes."}
      </Text>
      {#each sections as section (section.group)}
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={[text.caption, { fontWeight: "600" }]}>{section.group.toUpperCase()}</Text>
          <View style={{ borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface }}>
            {#each section.features as feature, index (feature.route)}
              <FeatureRow title={feature.title} summary={feature.summary} first={index === 0} onPress={() => router.goto(feature.route)} />
            {/each}
          </View>
        </View>
      {/each}
    </ScrollView>
  </SafeAreaView>
</Screen>

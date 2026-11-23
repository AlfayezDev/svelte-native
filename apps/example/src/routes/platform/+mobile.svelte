<script lang="ts">
  import { SafeAreaView, Screen, ScrollView, Switch, Text, TextInput, View, insets } from "expo-svelte";
  import Button from "#lib/components/Button.svelte";
  import Section from "#lib/components/Section.svelte";
  import { scroller, useDemo } from "#lib/demo.ts";
  import { text, theme } from "#lib/theme.svelte.ts";
  import { Dimensions, Keyboard, Platform } from "expo-svelte/platform";

  // What the platform tells the app. The library has `insets` (the safe area and the keyboard, as reactive state) and the options of `<Screen>`
  // for the system bars. The rest is React Native's own JavaScript modules, which `expo-svelte/platform` exports with their types:
  // `Platform` (which OS), `Dimensions` (the size of the screen) and `Keyboard` (`dismiss()` closes it); `Appearance` (light or dark) is read by the
  // theme in src/lib/theme.svelte.ts.
  // Read `insets` anywhere and the view updates when it changes, for example when the keyboard opens.
  const size = Dimensions.get("window");
  let hideStatusBar = $state(false);
  let field: { focus(): void; blur(): void } | null = null;
  const row = $derived({ flexDirection: "row" as const, justifyContent: "space-between" as const });

  // `?demo`: scroll to the keyboard section and open the keyboard from code, close it, then hide the status bar and show it again.
  let { url }: { url: URL } = $props();
  const view = scroller();
  useDemo(() => url, [
    [() => view.glide(420, 1200), 400],
    [() => field?.focus(), 2200],
    [() => field?.blur(), 800],
    [() => (hideStatusBar = true), 1600],
    [() => (hideStatusBar = false), 800],
    [() => view.glide(0, 1000), 0],
  ]);
</script>

<Screen title="Platform" statusBar={{ style: "auto", hidden: hideStatusBar }}>
  <SafeAreaView edges={["left", "right", "bottom"]} style={{ flex: 1 }}>
    <ScrollView ref={view.ref} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 24 }}>
      <Text style={text.body}>The device is more than a screen: it has a safe area, a status bar, a keyboard and a light and a dark mode. The app can read all of them.</Text>

      <Section title="Device" note="Platform.OS, Platform.Version and the size of the window in points.">
        <View style={row}><Text style={text.body}>System</Text><Text style={text.body}>{Platform.OS} {Platform.Version}</Text></View>
        <View style={row}><Text style={text.body}>Window</Text><Text style={text.body}>{Math.round(size.width)} x {Math.round(size.height)}</Text></View>
        <View style={row}><Text style={text.body}>Pixel density</Text><Text style={text.body}>{size.scale}x</Text></View>
        <View style={row}><Text style={text.body}>Text size</Text><Text style={text.body}>{size.fontScale}x</Text></View>
      </Section>

      <Section title="Safe area" note="The notch, the status bar and the home indicator take space. insets says how much; SafeAreaView pads by it.">
        <View style={row}><Text style={text.body}>Top</Text><Text style={text.body}>{insets.top}</Text></View>
        <View style={row}><Text style={text.body}>Bottom</Text><Text style={text.body}>{insets.bottom}</Text></View>
        <View style={row}><Text style={text.body}>Left and right</Text><Text style={text.body}>{insets.left} and {insets.right}</Text></View>
      </Section>

      <Section title="Keyboard" note="Tap the field. insets reports the keyboard as soon as it opens.">
        <TextInput ref={(handle) => (field = handle)} placeholder="Tap to open the keyboard" placeholderTextColor={theme.colors.muted} accessibilityLabel="Keyboard test" style={{ minHeight: 48, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, color: theme.colors.text, fontSize: 16 }} />
        <Text style={text.body}>{insets.keyboardVisible ? `Open, ${Math.round(insets.keyboardHeight)} high` : "Closed"}</Text>
        <Button label="Dismiss the keyboard" variant="secondary" onPress={() => Keyboard.dismiss()} />
      </Section>

      <Section title="Status bar" note="The statusBar option of Screen sets its style and can hide it. This screen asks for the style that fits the system's mode.">
        <View style={[row, { alignItems: "center" }]}>
          <Text style={text.body}>Hide the status bar</Text>
          <Switch bind:value={hideStatusBar} accessibilityLabel="Hide the status bar" />
        </View>
      </Section>

      <Section title="Appearance" note="Appearance.getColorScheme() says light or dark and addChangeListener tells you when it changes. The theme keeps the answer in $state, so every colour of the app follows it.">
        <Text style={text.body}>The system is in {theme.dark ? "dark" : "light"} mode.</Text>
      </Section>
    </ScrollView>
  </SafeAreaView>
</Screen>

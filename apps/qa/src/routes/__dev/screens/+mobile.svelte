<script lang="ts">
  import { KeyboardAvoidingView, Pressable, SafeAreaView, Screen, ScrollView, Tabs, Text, TextInput, View, useRouter, type TabHandle, type TabItem, type ToolbarItem } from "@alfayez/svelte-native";
  import { nativeLabEnabled, theme } from "#lib/native/state.svelte.ts";
  import { screenLab } from "#lib/native/dev/model.svelte.ts";
  import Button from "#lib/native/components/Button.svelte";
  import LabTabStack from "#lib/native/dev/LabTabStack.svelte";

  /**
   * The native screens lab: `?mode=` picks the page. The menu opens the others; the stress scenarios header-8 and sheet-8
   * open `header` and `sheet` directly. Sheets and modals are presented by the caller (`goto(..., { presentation })`).
   * `toolbar` and `toolbar-center` are reached by link only (`/__dev/screens?mode=toolbar`): a menu button for them would
   * move the rows the parity references of the menu, the sheets and the modal show.
   */
  let { url }: { url?: URL } = $props();
  const router = useRouter();
  const mode = $derived(url?.searchParams.get("mode") ?? "menu");
  const depth = $derived(Number(url?.searchParams.get("depth") ?? "1"));
  const rows = Array.from({ length: 24 }, (_, index) => index + 1);
  const people = ["Amal", "Basma", "Dana", "Faris", "Ghada", "Hamza", "Ibrahim", "Jumana", "Khalid", "Layla", "Majed", "Noor"];
  let query = $state("");
  const matches = $derived(people.filter((name) => name.toLowerCase().includes(query.toLowerCase())));
  let detent = $state("0");
  let tabSelected = $state("home");
  let left = $state("Segment A");
  let toolbarPressed = $state("none");
  let arrangement = $state("List");

  // A 24 px asset (a data URI) for the first tab; the other two draw their icon from a snippet.
  const disc = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAAcklEQVR42mNgGAkgHojXAPEDIP4NxQ+gYvGUGgwy6D8B/IAciyYRYTA6nkRLw4m2JJ4Cw2EYb3A9oIIFD2jpery+WENFC9bQKnjwBtNvKlrwe0AsoHkQ0TySaZ5MaZ7R6FJU0Lywo0txTZcKhy5V5tAAABEGOLR+xGf5AAAAAElFTkSuQmCC";
  const tabItems: TabItem[] = [
    { key: "home", title: "Home", icon: { uri: disc }, badge: true },
    { key: "inbox", title: "Inbox", icon: square, badge: 120 },
    { key: "me", title: "Me", icon: ring },
  ];
  // The toolbar pages: two actions with an asset icon, flexible space, a dot badge on a snippet icon, a disabled action.
  const toolbarItems: ToolbarItem[] = [
    { key: "reply", title: "Reply", icon: { uri: disc }, accessibilityLabel: "Reply" },
    { key: "archive", title: "Archive", icon: { uri: disc }, accessibilityLabel: "Archive" },
    { key: "gap", spacer: true },
    { key: "flag", title: "Flag", icon: square, badge: true, accessibilityLabel: "Flag" },
    { key: "delete", title: "Delete", icon: { uri: disc }, disabled: true, accessibilityLabel: "Delete" },
  ];
  // With a center the spacer is where it goes: one action on each side of the switch.
  const composeItems: ToolbarItem[] = [
    { key: "attach", title: "Attach", icon: { uri: disc }, accessibilityLabel: "Attach" },
    { key: "gap", spacer: true },
    { key: "send", title: "Send", icon: { uri: disc }, accessibilityLabel: "Send" },
  ];
  const pressToolbar = (key: string) => { toolbarPressed = key; };
</script>

{#snippet button(label: string, press: () => void, variant: "primary" | "secondary" = "secondary")}
  <Button {label} variant={variant} onPress={press} />
{/snippet}
{#snippet card(text: string)}
  <View style={{ padding: 12, borderRadius: 10, borderWidth: screenLab.rows === "plain" ? 0 : 1, overflow: screenLab.rows === "image" ? "visible" : "hidden", borderColor: theme.border, backgroundColor: theme.surface }}>
    <Text style={{ color: theme.foreground, fontSize: 15 }}>{text}</Text>
  </View>
{/snippet}
{#snippet square(selected: boolean)}
  <View style={{ width: 18, height: 18, borderRadius: 4, backgroundColor: "#000000", opacity: selected ? 1 : 0.6 }} />
{/snippet}
{#snippet ring(selected: boolean)}
  <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 3, borderColor: "#000000", opacity: selected ? 1 : 0.6 }} />
{/snippet}
{#snippet pane(tab: TabHandle)}
  <LabTabStack {tab} />
{/snippet}
{#snippet bell()}
  <Pressable accessibilityRole="button" accessibilityLabel="Notifications" onPress={() => router.goto("/__dev/screens?mode=sheet", { presentation: "sheet" })} style={{ minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" }}>
    <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: theme.foreground }} />
  </Pressable>
{/snippet}
{#snippet close()}
  <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => router.back()} style={{ minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" }}>
    <Text style={{ color: theme.foreground, fontSize: 18 }}>×</Text>
  </Pressable>
{/snippet}
{#snippet segmented(labels: string[], value: string, choose: (label: string) => void)}
  <View style={{ flexDirection: "row", borderRadius: 18, borderWidth: 1, borderColor: theme.border, overflow: "hidden" }}>
    {#each labels as label (label)}
      <Pressable accessibilityRole="button" onPress={() => choose(label)} style={{ paddingHorizontal: 12, minHeight: 36, justifyContent: "center", backgroundColor: value === label ? theme.surface : "transparent" }}>
        <Text style={{ color: theme.foreground, fontSize: 13 }}>{label}</Text>
      </Pressable>
    {/each}
  </View>
{/snippet}
{#snippet segments()}
  {@render segmented(["Segment A", "Segment B"], left, (label) => { left = label; })}
{/snippet}
{#snippet arrangements()}
  {@render segmented(["List", "Grid"], arrangement, (label) => { arrangement = label; })}
{/snippet}
{#snippet results()}
  <ScrollView style={{ flex: 1, backgroundColor: theme.background }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 8 }}>
    {#each matches as name (name)}{@render card(name)}{/each}
    {#if matches.length === 0}<Text style={{ color: theme.muted, fontSize: 15 }}>No one called "{query}"</Text>{/if}
  </ScrollView>
{/snippet}

{#if nativeLabEnabled}
  {#if mode === "menu"}
    <Screen title="Native screens" subtitle="Header, sheet, tabs" header={{ large: true }} headerRight={bell} style={{ backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, direction: theme.direction }}>
        <Text style={{ color: theme.muted, fontSize: 14 }}>Each page below is a real screen: the engine draws its header, sheet and tab bar.</Text>
        {@render button("Push eight screens with headers", () => router.goto("/__dev/screens?mode=header&depth=1"), "primary")}
        {@render button("Header slots and search", () => router.goto("/__dev/screens?mode=slots"))}
        {@render button("Translucent header over content", () => router.goto("/__dev/screens?mode=translucent"))}
        {@render button("Sheet with two detents", () => router.goto("/__dev/screens?mode=sheet", { presentation: "sheet" }))}
        {@render button("Sheet that fits its content", () => router.goto("/__dev/screens?mode=auto", { presentation: "sheet" }))}
        {@render button("Form sheet", () => router.goto("/__dev/screens?mode=form", { presentation: "formSheet" }))}
        {@render button("Modal", () => router.goto("/__dev/screens?mode=header&depth=1", { presentation: "modal" }))}
        {@render button("Bottom tabs, a stack in each", () => router.goto("/__dev/screens?mode=tabs"))}
        {#each rows as row (row)}{@render card(`Row ${row}`)}{/each}
      </ScrollView>
    </Screen>
  {:else if mode === "header"}
    <Screen title={screenLab.header === "plain" ? undefined : `Screen ${depth}`} subtitle={screenLab.header === "full" ? "Native header" : undefined} headerRight={screenLab.header === "full" ? bell : undefined} onAppear={() => { screenLab.appears++; }} onDisappear={() => { screenLab.disappears++; }} style={{ backgroundColor: theme.background }}>
      <SafeAreaView edges={["bottom", "left", "right"]} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 10, direction: theme.direction }}>
          {#each rows as row (row)}{@render card(`Screen ${depth} · row ${row}`)}{/each}
          {@render button(`Push screen ${depth + 1}`, () => router.goto(`/__dev/screens?mode=header&depth=${depth + 1}`), "primary")}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  {:else if mode === "slots"}
    <Screen title="Slots" headerLeft={close} headerCenter={segments} headerRight={bell} search={{ value: query, placeholder: "Search people", onChangeText: (text) => { query = text; }, onCancel: () => { query = ""; } }} headerSearch={results} style={{ backgroundColor: theme.background }}>
      <SafeAreaView edges={["bottom", "left", "right"]} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 10, direction: theme.direction }}>
          {@render card(`Left slot closes, center slot is "${left}", right slot opens a sheet.`)}
          {#each rows as row (row)}{@render card(`Row ${row}`)}{/each}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  {:else if mode === "translucent"}
    <Screen title="Translucent" subtitle="Content runs under the bar" header={{ translucent: true, background: theme.dark ? "#101113e6" : "#f6f6f7e6" }} style={{ backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10, direction: theme.direction }}>
        {#each rows as row (row)}{@render card(`Under the header · row ${row}`)}{/each}
      </ScrollView>
    </Screen>
  {:else if mode === "sheet"}
    <Screen sheet={{ detents: [0.4, 0.9], grabber: true }} onAppear={() => { screenLab.appears++; }} onDisappear={() => { screenLab.disappears++; }} onDetentChange={(event) => { screenLab.detents++; detent = `${event.index} (${event.fraction.toFixed(2)})`; }} style={{ backgroundColor: theme.surface }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 28, gap: 10, direction: theme.direction }}>
        <Text accessibilityRole="header" style={{ color: theme.foreground, fontSize: 20, fontWeight: "600" }}>Two detents</Text>
        <Text style={{ color: theme.muted, fontSize: 14 }}>Drag between 40 % and 90 %; below the lower one it dismisses. Detent {detent}.</Text>
        {#each rows as row (row)}{@render card(`Sheet row ${row}`)}{/each}
        {@render button("Close", () => router.back())}
      </ScrollView>
    </Screen>
  {:else if mode === "auto"}
    <Screen sheet={{ detents: ["auto"], dismissible: true }} style={{ backgroundColor: theme.surface }}>
      <View style={{ padding: 20, paddingTop: 32, gap: 12 }}>
        <Text accessibilityRole="header" style={{ color: theme.foreground, fontSize: 20, fontWeight: "600" }}>Fits its content</Text>
        <Text style={{ color: theme.muted, fontSize: 14 }}>One detent, as tall as this text and the button.</Text>
        {@render button("Done", () => router.back(), "primary")}
      </View>
    </Screen>
  {:else if mode === "form"}
    <Screen title="Form sheet" headerLeft={close} sheet={{ grabber: false }} style={{ backgroundColor: theme.background }}>
      <View style={{ padding: 16, gap: 12 }}>
        <TextInput accessibilityLabel="Name" placeholder="Name" placeholderTextColor={theme.muted} style={{ minHeight: 52, borderWidth: 1, borderColor: theme.border, borderRadius: 12, overflow: "hidden", paddingHorizontal: 14, backgroundColor: theme.surface, color: theme.foreground, fontSize: 17 }} />
        {@render button("Save", () => router.back(), "primary")}
      </View>
    </Screen>
  {:else if mode === "keyboard"}
    <Screen title="Keyboard" style={{ backgroundColor: theme.background }}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <View style={{ flex: 1, padding: 16 }}>{@render card("The field below sits at the bottom; the keyboard must not cover it.")}</View>
        <SafeAreaView edges={["bottom", "left", "right"]}>
          <View style={{ padding: 16 }}>
            <TextInput accessibilityLabel="Message" placeholder="Message" placeholderTextColor={theme.muted} style={{ minHeight: 52, borderWidth: 1, borderColor: theme.border, borderRadius: 12, overflow: "hidden", paddingHorizontal: 14, backgroundColor: theme.surface, color: theme.foreground, fontSize: 17 }} />
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Screen>
  {:else if mode === "toolbar"}
    <Screen title="Toolbar" subtitle="Four actions" toolbar={{ items: toolbarItems, onPress: pressToolbar }} style={{ backgroundColor: theme.background }}>
      <SafeAreaView edges={["left", "right"]} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 10, direction: theme.direction }}>
          {@render card(`Last press: ${toolbarPressed}`)}
          {#each rows as row (row)}{@render card(`Row ${row}`)}{/each}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  {:else if mode === "toolbar-center"}
    <Screen title="Toolbar center" toolbar={{ items: composeItems, onPress: pressToolbar }} toolbarCenter={arrangements} style={{ backgroundColor: theme.background }}>
      <SafeAreaView edges={["left", "right"]} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 10, direction: theme.direction }}>
          {@render card(`Layout: ${arrangement}. Last press: ${toolbarPressed}`)}
          {#each rows as row (row)}{@render card(`Row ${row}`)}{/each}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  {:else if mode === "tabs"}
    <Tabs items={tabItems} selected={tabSelected} onSelect={(key) => { tabSelected = key; }} content={pane} tint={theme.foreground} />
  {/if}
{/if}

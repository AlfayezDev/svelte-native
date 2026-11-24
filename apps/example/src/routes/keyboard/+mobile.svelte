<script lang="ts">
  import { AnimatedView, KeyboardChatScrollView, KeyboardStickyView, Pressable, Screen, Text, TextInput, View, createKeyboardMotion, insets } from "expo-svelte";
  import { theme, text } from "#lib/theme.svelte.ts";

  // A chat thread and its composer. The composer is a KeyboardStickyView: it rides the keyboard's animation frame by frame, as a translation of the keyboard's height less
  // the inset it already stands above (`opened`). The thread is a KeyboardChatScrollView: while the keyboard moves its content lifts with it, with `keyboardLiftBehavior`
  // saying when (try each: scroll up the thread and open the keyboard). The bar is `createKeyboardMotion()`'s progress shared value, read by a worklet on the UI thread.
  const behaviors = ["always", "whenAtEnd", "never"] as const;
  let behavior = $state<(typeof behaviors)[number]>("whenAtEnd");
  let atEnd = $state(true);
  let draft = $state("");
  let messages = $state(Array.from({ length: 24 }, (_, index) => ({ id: index, mine: index % 3 === 2, text: index % 3 === 2 ? `Message ${index + 1}, from you.` : `Message ${index + 1}, a longer one from somebody else that wraps over two lines.` })));
  let thread: { scrollToEnd(options?: { animated?: boolean }): void } | null = null;
  const motion = createKeyboardMotion();

  function send() {
    if (draft.trim() === "") return;
    messages.push({ id: messages.length, mine: true, text: draft.trim() });
    draft = "";
    setTimeout(() => thread?.scrollToEnd({ animated: true }), 50);
  }
</script>

<Screen title="Keyboard">
  <View style={{ flex: 1 }}>
    <View style={{ flexDirection: "row", gap: 8, padding: 12 }}>
      {#each behaviors as option (option)}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={option}
          accessibilityState={{ selected: behavior === option }}
          onPress={() => (behavior = option)}
          style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: behavior === option ? theme.colors.accent : theme.colors.surface }}
        >
          <Text style={{ color: behavior === option ? theme.colors.onAccent : theme.colors.text, fontSize: 14 }}>{option}</Text>
        </Pressable>
      {/each}
    </View>
    <KeyboardChatScrollView ref={(handle) => (thread = handle)} keyboardLiftBehavior={behavior} onEndVisible={(visible) => (atEnd = visible)} keyboardShouldPersistTaps="handled" style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 8 }}>
      {#each messages as message (message.id)}
        <View style={{ alignSelf: message.mine ? "flex-end" : "flex-start", maxWidth: "80%", padding: 12, borderRadius: 16, backgroundColor: message.mine ? theme.colors.accent : theme.colors.surface }}>
          <Text style={{ color: message.mine ? theme.colors.onAccent : theme.colors.text, fontSize: 16 }}>{message.text}</Text>
        </View>
      {/each}
    </KeyboardChatScrollView>
    <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }} style={{ backgroundColor: theme.colors.surface, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
      <AnimatedView
        style={{ height: 4, backgroundColor: theme.colors.accent }}
        animatedStyle={() => {
          "worklet";
          return { transform: [{ scaleX: motion.progress.value }] };
        }}
      />
      <Text style={[text.body, { paddingHorizontal: 16, paddingTop: 8, fontSize: 13 }]} accessibilityLabel="Keyboard state">Keyboard {insets.keyboardState}, end of the thread {atEnd ? "in view" : "out of view"}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12, paddingBottom: 12 + insets.bottom }}>
        <TextInput
          bind:value={draft}
          placeholder="Message"
          placeholderTextColor={theme.colors.muted}
          accessibilityLabel="Message"
          onSubmitEditing={send}
          style={{ flex: 1, minHeight: 44, paddingHorizontal: 12, borderRadius: 22, borderWidth: 1, borderColor: theme.colors.border, color: theme.colors.text, fontSize: 16 }}
        />
        <Pressable accessibilityRole="button" accessibilityLabel="Send" onPress={send} style={{ minHeight: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: theme.colors.accent, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: theme.colors.onAccent, fontSize: 16 }}>Send</Text>
        </Pressable>
      </View>
    </KeyboardStickyView>
  </View>
</Screen>

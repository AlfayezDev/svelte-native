<script lang="ts">
  import { onDestroy } from "svelte";
  import { Text, View } from "@rasheed/svelte-native";
  import { AnimatedView, createSharedValue, runOnJS, withSpring, withTiming } from "@rasheed/svelte-native/animation";
  import { Gesture } from "@rasheed/svelte-native/gestures";
  import { text, theme } from "#lib/theme.svelte.ts";

  // A row that is deleted by swiping it left. One Pan, on the UI thread: it follows the finger, and past 100 pt on release it asks the screen to
  // remove the row (`runOnJS` calls a plain function on the JavaScript thread; a worklet cannot read props). Otherwise it springs back.
  // The row must not be the only way to delete: `accessibilityActions` gives screen readers a "Delete" action.
  let { label, onDelete }: { label: string; onDelete: () => void } = $props();
  const x = createSharedValue(0); // first: it loads Reanimated
  const remove = () => onDelete();
  let removal: ReturnType<typeof setTimeout> | undefined;
  /** Swipes the row away by itself, the way a finger would: the demo (`#lib/demo.ts`) of the Gestures screen uses it. */
  export function swipeAway() {
    x.value = withTiming(-160, { duration: 350 });
    removal = setTimeout(remove, 400);
  }
  onDestroy(() => clearTimeout(removal));
  const swipe = Gesture.Pan()
    .activeOffsetX([-10, 10]) // a horizontal move starts the swipe ...
    .failOffsetY([-10, 10]) // ... a vertical one is the page scrolling
    .onUpdate((event) => { x.value = Math.min(0, event.translationX); })
    .onEnd((event) => {
      if (event.translationX < -100) runOnJS(remove)();
      else x.value = withSpring(0);
    });
</script>

<View style={{ height: 52, borderRadius: 10, overflow: "hidden", backgroundColor: theme.colors.danger, justifyContent: "center", alignItems: "flex-end", paddingRight: 16 }}>
  <Text style={{ color: theme.colors.onAccent, fontWeight: "600" }}>Delete</Text>
  <AnimatedView
    gesture={swipe}
    accessible
    accessibilityLabel={label}
    accessibilityActions={[{ name: "delete", label: "Delete" }]}
    onAccessibilityAction={() => onDelete()}
    animatedStyle={() => { "worklet"; return { transform: [{ translateX: x.value }] }; }}
    style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, justifyContent: "center", paddingHorizontal: 16, backgroundColor: theme.colors.surface }}
  >
    <Text style={text.body}>{label}</Text>
  </AnimatedView>
</View>

<!-- The entries `@alfayez/svelte-native/animation`, `/gestures`, `/svg`, `/native-modules` and `/fabric` are deprecated aliases until 0.4.0-rc.7: an app that still imports them
     has to type-check as before (an editor strikes the names through; svelte-check does not fail on it). `tests/node-modules.test.ts` type-checks this file with `typed.svelte`. -->
<script lang="ts">
  import { View } from "@alfayez/svelte-native";
  import { AnimatedView, createSharedValue, withSpring } from "@alfayez/svelte-native/animation";
  import { Gesture, GestureDetector } from "@alfayez/svelte-native/gestures";
  import { Svg, Path, Text as SvgText, Image as SvgImage, type SvgHandle } from "@alfayez/svelte-native/svg";
  import { turboModule, nativeModule } from "@alfayez/svelte-native/native-modules";
  import { createFabricApp, remountSurfaces } from "@alfayez/svelte-native/fabric";

  const x = createSharedValue(0);
  const pan = Gesture.Pan().onUpdate((e) => { x.value = e.translationX; }).onEnd(() => { x.value = withSpring(0); });
  const handle: SvgHandle | null = null;
  void [handle, turboModule, nativeModule, createFabricApp, remountSurfaces];
</script>

<View gesture={pan}>
  <AnimatedView style={{ width: 8, height: 8 }} animatedStyle={() => { "worklet"; return { transform: [{ translateX: x.value }] }; }} />
  <GestureDetector gesture={pan}><View /></GestureDetector>
  <Svg width={40} height={40}><Path d="M0 0L10 10" stroke="#000" /><SvgText x={1} y={2}>t</SvgText><SvgImage href="x" width={4} height={4} /></Svg>
</View>

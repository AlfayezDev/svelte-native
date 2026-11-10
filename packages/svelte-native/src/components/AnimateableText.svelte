<script lang="ts">
  import type {} from "../elements.d.ts";
  import type { ClassProps } from "../classes.ts";
  import { createNativeProps } from "../native-props.ts";
  import type { TextProps } from "react-native";

  /**
   * The native text view of `react-native-animateable-text` (`JBAnimatedText`) as a Svelte component: a `Text` whose string is the
   * `text` prop, so a Reanimated worklet can set it on the UI thread. `animatedProps` is a worklet returning the props to animate, as
   * the library's `useAnimatedProps` callback does (`() => { "worklet"; return { text: String(count.value) }; }`): the host
   * attaches it like `animatedStyle` (SPEC.md, "Animated write path") and the shared values it reads write the node's `text` without the
   * JavaScript thread; `text` is the string of the first commit and the one shown without `animatedProps`. The props are the `Text`
   * ones (`style`, `numberOfLines`, `ellipsizeMode`, `selectable`, `selectionColor`, `allowFontScaling`, `onTextLayout`, ...);
   * there are no children and no nested text. Without `animatedProps` the key is not sent at all (the host loads Reanimated for a node that has it). Not ported: `onPress`, `onLongPress` and the touchable highlight of the library's text.
   */
  let { text, animatedProps, style, ref, ...attributes }: Omit<TextProps, "children" | "onPress" | "onLongPress"> & {
    text?: string;
    /** A worklet (or an array of them) returning `{ text }`: read shared values and run on the UI runtime. */
    animatedProps?: (() => { text?: string }) | ReadonlyArray<() => { text?: string }>;
    /** Receives the host handle (`tag`, `measure`, ...), or null on unmount. */
    ref?: (handle: unknown) => void;
  } & ClassProps = $props();
  const resolveProps = createNativeProps();
</script>
<native-foreign component="JBAnimatedText" nativeProps={resolveProps({ ...attributes, text, ...(animatedProps ? { animatedProps } : null), style, ref })}></native-foreign>

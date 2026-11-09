<script lang="ts">
  import { View } from "@example/svelte-native";
  import { createSharedValue, withRepeat, withTiming } from "@example/svelte-native/animation";
  import { Circle, Defs, LinearGradient, Path, Rect, Stop, Svg, SvgXml, Text as SvgText } from "@example/svelte-native/svg";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { theme } from "#lib/theme.svelte.ts";

  // `@example/svelte-native/svg` is react-native-svg as Svelte components: the same elements and props (`Svg`, `Rect`, `Circle`, `Path`, the
  // gradients, ...). `animatedProps` on any element is a worklet that writes native props on the UI thread, here the circle's radius from a
  // shared value. `SvgXml` draws a whole SVG document from a string. `Text` is imported as `SvgText`, the primitive keeps the name.
  const radius = createSharedValue(6); // first: it loads Reanimated, so the worklet below captures the real functions
  radius.value = withRepeat(withTiming(14, { duration: 900 }), -1, true);
  const pulse = () => { "worklet"; return { r: radius.value }; };
  const check = `<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" fill="none" stroke="#30a46c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
</script>

<Page title="SVG" intro="Svg draws vector graphics with react-native-svg's elements. Shapes, paths, gradients and text are components, and a circle can be animated on the UI thread without JavaScript.">
  <Section title="Shapes, gradient and text">
    <View style={{ alignItems: "center" }}>
      <Svg width={200} height={100} viewBox="0 0 200 100" accessibilityLabel="A gradient card with a pulsing dot">
        <Defs>
          <LinearGradient id="card" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#ff7a18" />
            <Stop offset="1" stopColor="#319197" />
          </LinearGradient>
        </Defs>
        <Rect width="200" height="100" rx="16" fill="url(#card)" />
        <Circle cx="40" cy="50" r="6" fill="#ffffff" animatedProps={pulse} />
        <SvgText x="110" y="57" fill="#ffffff" fontSize="22" fontWeight="bold" textAnchor="middle">SVG</SvgText>
      </Svg>
    </View>
  </Section>

  <Section title="Path and SvgXml" note="Left: a heart as a Path. Right: the same kind of drawing from an XML string.">
    <View style={{ flexDirection: "row", justifyContent: "space-around", alignItems: "center" }}>
      <Svg width={64} height={64} viewBox="0 0 24 24" accessibilityLabel="A heart">
        <Path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z" fill="#e5484d" stroke={theme.colors.text} strokeWidth={1} />
      </Svg>
      <SvgXml xml={check} width={64} height={64} />
    </View>
  </Section>
</Page>

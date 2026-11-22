<script>
  let shown = $state(true);
  let padding = $state(1);
  let css = $state(true);
  let inline = $state(false);
  const opacity = { value: 0.25, _isReanimatedSharedValue: true };
  const fade = () => ({ opacity: 0.5, transform: [{ scale: 2 }] });
  const tint = () => ({ backgroundColor: "red" });
  let styles = $state([fade]);
  let withProps = $state(false);
  let animate = $state(true);
  let shorthand = $state(false);
  const label = () => ({ accessibilityLabel: "count 3" });
  export function useProps() { withProps = true; }
  export function stopAnim() { animate = false; }
  export function useShorthand() { shorthand = true; }
  export function hide() { shown = false; }
  export function show() { shown = true; }
  export function pad(n) { padding = n; }
  export function dropCss() { css = false; }
  export function useInline() { inline = true; }
  export function two() { styles = [fade, tint]; }
</script>
<native-view testID="plain" nativeStyle={{ padding: 1 }}></native-view>
<native-view testID="plain2" nativeStyle={{ padding }}></native-view>
{#if shorthand}
  <native-animated-view testID="shorthand" nativeStyle={{ padding: 2, transition: "opacity 300ms" }}></native-animated-view>
{/if}
{#if shown}
  <native-animated-view testID="anim" animatedStyle={animate ? (styles.length === 1 ? styles[0] : styles) : undefined} nativeStyle={{ padding }}></native-animated-view>
  {#if css}
    <native-animated-view testID="css" animationName={{ from: { opacity: 0 }, to: { opacity: 1 } }} animationDuration="1s" nativeStyle={{ padding, transitionProperty: "padding", transitionDuration: "200ms" }}></native-animated-view>
  {/if}
  {#if withProps}
    <native-animated-view testID="props" animatedStyle={fade} animatedProps={label} nativeStyle={{ padding }}></native-animated-view>
  {/if}
  {#if inline}
    <native-animated-view testID="inline" nativeStyle={{ opacity, padding: 3 }}></native-animated-view>
  {/if}
{/if}

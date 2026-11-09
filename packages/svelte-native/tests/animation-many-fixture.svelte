<script>
  const fade = () => ({ opacity: 0.5 });
  let count = $state(20);
  let padding = $state(0);
  export function keep(n) { count = n; }
  export function pad(n) { padding = n; }
</script>
{#each Array.from({ length: count }, (_, index) => index) as index (index)}
  <native-animated-view testID={`node${index}`} animatedStyle={fade} nativeStyle={{ padding }}></native-animated-view>
{/each}

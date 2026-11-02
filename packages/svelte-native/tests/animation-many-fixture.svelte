<script>
  const fade = () => ({ opacity: 0.5 });
  let count = $state(20);
  export function keep(n) { count = n; }
</script>
{#each Array.from({ length: count }, (_, index) => index) as index (index)}
  <native-animated-view testID={`node${index}`} animatedStyle={fade}></native-animated-view>
{/each}

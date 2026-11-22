<script>
  import { MediaQuery } from "svelte/reactivity";
  let { queries, readers = 1 } = $props();
  // The queries are read once, as an app writes `new MediaQuery("...")` at the top of a component.
  // svelte-ignore state_referenced_locally
  const lists = Array.from({ length: readers }, () => queries.map((query) => new MediaQuery(query))).flat();
</script>
{#each lists as list, index (index)}
  <native-view testID={`${index}:${list.current}`}></native-view>
{/each}

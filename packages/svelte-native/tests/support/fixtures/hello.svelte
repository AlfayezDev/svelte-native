<script>
  let name = $state("world");
  export function rename(next) { name = next; }
</script>
<native-text>Hello {name}</native-text>

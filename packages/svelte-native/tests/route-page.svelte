<script>
  let { params, url } = $props();
</script>
<native-text>page {url.pathname}{params.id ? `:${params.id}` : ""}</native-text>

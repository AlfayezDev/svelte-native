<script>
  // An input of the app that passes what it is given down: `type`, `oninput`, `disabled`, `maxlength` and the rest come in `rest`.
  let { value = $bindable(""), ...rest } = $props();
</script>
<input bind:value {...rest} />

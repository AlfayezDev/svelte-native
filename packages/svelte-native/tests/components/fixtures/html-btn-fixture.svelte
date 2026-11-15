<script>
  // A button of the app that passes what it is given down: the text comes in `children`, and `type`, `onclick` and the rest in `rest`.
  let { children, ...rest } = $props();
</script>
<button {...rest}>{@render children?.()}</button>

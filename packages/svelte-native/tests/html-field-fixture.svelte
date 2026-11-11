<script lang="ts">
  // A field of a form in a component of its own: its button and its input are in the form by where they are in the tree, not by the file.
  let { name = $bindable("") }: { name?: string } = $props();
</script>

<input testID="field-input" bind:value={name} />
<button testID="field-submit" type="submit">Go</button>

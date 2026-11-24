<script>
  import KeyboardStickyView from "../../../src/components/KeyboardStickyView.svelte";
  import KeyboardChatScrollView from "../../../src/components/KeyboardChatScrollView.svelte";
  import KeyboardAwareScrollView from "../../../src/components/KeyboardAwareScrollView.svelte";
  import KeyboardAvoidingView from "../../../src/components/KeyboardAvoidingView.svelte";
  let { kind, props = {}, ends = [] } = $props();
</script>
{#if kind === "sticky"}
  <KeyboardStickyView {...props} style={{ flex: 1 }}><native-view testID="content"></native-view></KeyboardStickyView>
{:else if kind === "chat"}
  <KeyboardChatScrollView {...props} onEndVisible={props.watch ? (visible) => ends.push(visible) : undefined}><native-view testID="content"></native-view></KeyboardChatScrollView>
{:else if kind === "aware"}
  <KeyboardAwareScrollView {...props}><native-view testID="content"></native-view></KeyboardAwareScrollView>
{:else}
  <KeyboardAvoidingView {...props} style={{ flex: 1 }} contentContainerStyle={{ flex: 1 }}><native-view testID="content"></native-view></KeyboardAvoidingView>
{/if}

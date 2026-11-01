<script>
  import View from "../src/components/View.svelte";
  let checked = $state(true);
  let label = $state("Terms");
  let hidden = $state(false);
  const actions = [];
  export function setChecked(next) { checked = next; }
  export function setLabel(next) { label = next; }
  export function setHidden(next) { hidden = next; }
  export function actionLog() { return actions; }
</script>
<View testID="box" role="checkbox" aria-checked={checked} aria-label={label} aria-live="off" accessibilityActions={[{ name: "archive", label: "Archive" }, { name: "activate" }]} onAccessibilityAction={(event) => actions.push(event.nativeEvent.actionName)} />
<View testID="plain" accessibilityState={{ selected: true }} aria-busy={true} aria-hidden={hidden} aria-valuenow={4} aria-valuemax={10} aria-valuemin={0} accessibilityValue={{ text: "four" }} />
<View testID="bare" accessibilityLabel="Bare" accessibilityState={{ disabled: true }} />
<View testID="named" aria-labelledby="terms, other" />

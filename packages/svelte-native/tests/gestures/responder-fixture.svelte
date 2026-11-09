<script>
  // A view that carries a gesture (set later by the test, so the gesture host loads while the surface is up) and two responders: one whose
  // grant answers `block`, one whose grant answers nothing.
  let { block = true } = $props();
  let gesture = $state.raw(undefined);
  export function setGesture(next) { gesture = next; }
</script>
<native-view testID="gestured" {gesture}></native-view>
<native-view testID="responder" onStartShouldSetResponder={() => true} onResponderGrant={() => block}></native-view>
<native-view testID="quiet" onStartShouldSetResponder={() => true} onResponderGrant={() => {}}></native-view>

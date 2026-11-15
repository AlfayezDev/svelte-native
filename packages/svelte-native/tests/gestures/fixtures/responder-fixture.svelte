<script>
  // A view that carries a gesture (set later by the test, so the gesture host loads while the surface is up) and one whose responder blocks the native ones.
  let gesture = $state.raw(undefined);
  export function setGesture(next) { gesture = next; }
</script>
<native-view testID="gestured" {gesture}></native-view>
<native-view testID="responder" onStartShouldSetResponder={() => true} onResponderGrant={() => true}></native-view>

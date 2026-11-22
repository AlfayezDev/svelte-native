<script lang="ts">
  // The uses that must not type-check; `types.test.ts` expects exactly these errors. Never run.
  import { Gesture, GestureDetector, type GestureAttribute } from "../../../../src/gestures/index.ts";
  Gesture.ForceTouch();
  const wrong: GestureAttribute = 42;
  void wrong;
</script>
<native-view gesture={42}></native-view>
<GestureDetector />

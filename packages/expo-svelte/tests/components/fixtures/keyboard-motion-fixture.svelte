<script>
  import { createKeyboardMotion } from "../../../src/keyboard-motion.ts";
  let { out } = $props();
  out.motion = createKeyboardMotion();
</script>
<native-view></native-view>

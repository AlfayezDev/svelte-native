<script lang="ts">
  import type {} from "../elements.d.ts";
  import { createNativeProps } from "../native-props.ts";
  import type { ImageProps } from "react-native";
  import type { GestureProps } from "../gestures/types.ts";
  let { ...attributes }: ImageProps & GestureProps = $props();
  const resolveProps = createNativeProps();
</script>
<native-image nativeProps={resolveProps(attributes)}></native-image>

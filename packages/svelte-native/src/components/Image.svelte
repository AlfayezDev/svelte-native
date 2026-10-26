<script lang="ts">
  import type {} from "../elements.d.ts";
  import { createNativeProps } from "../native-props.ts";
  import type { ImageProps } from "react-native";
  let { ...attributes }: ImageProps = $props();
  const resolveProps = createNativeProps();
</script>
<native-image nativeProps={resolveProps(attributes)}></native-image>

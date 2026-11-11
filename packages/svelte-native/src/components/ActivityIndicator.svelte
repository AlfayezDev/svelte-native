<script lang="ts">
  import type {} from "../elements.d.ts";
  import type { ClassProps } from "../classes.ts";
  import { createNativeProps } from "../native-props.ts";
  import type { ActivityIndicatorProps } from "react-native";
  let { ...attributes }: ActivityIndicatorProps & ClassProps = $props();
  const resolveProps = createNativeProps();
</script>
<native-spinner nativeProps={resolveProps(attributes)}></native-spinner>

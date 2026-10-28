// Reanimated internals the Fabric host needs but Reanimated does not export. Metro resolves "react-native-reanimated" to its
// `src` (package.json "react-native" field), so these deep paths load the same module instances as the public entry.
// Kept as plain JavaScript beside a hand-written `.d.ts` so the type checker never compiles Reanimated's TypeScript source.
export { initialUpdaterRun } from "react-native-reanimated/src/animation/util";
export { CSSManager } from "react-native-reanimated/src/css/platform";
export { markNodeAsRemovable } from "react-native-reanimated/src/css/native/proxy";
export { filterCSSAndStyleProperties } from "react-native-reanimated/src/css/utils";
export { getInlineStyle, hasInlineStyles, InlinePropManager } from "react-native-reanimated/src/createAnimatedComponent/InlinePropManager";
export { isAnimated, shallowEqual, validateAnimatedStyles } from "react-native-reanimated/src/hook/utils";
export { updateProps } from "react-native-reanimated/src/updateProps";
export { makeViewDescriptorsSet } from "react-native-reanimated/src/ViewDescriptorsSet";
export { maybeBuild } from "react-native-reanimated/src/animationBuilder";
export { updateLayoutAnimations } from "react-native-reanimated/src/UpdateLayoutAnimations";
export { LayoutAnimationType } from "react-native-reanimated/src/commonTypes";
export { WorkletEventHandler } from "react-native-reanimated/src/WorkletEventHandler";

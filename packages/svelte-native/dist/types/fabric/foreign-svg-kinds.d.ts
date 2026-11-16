/**
 * The view configs of react-native-svg's Fabric components, registered when this module loads (SPEC.md, "react-native-svg"): the props of each codegen
 * spec (`src/fabric/*NativeComponent.ts`) and the events its emitter sends, on top of a view's own attributes. `tests/foreign/svg/configs.test.ts` compares every
 * table with the config React Native generates from the spec, on both platforms. A module of its own, with no import of the library, so that the test
 * can load it next to React Native's registry.
 */
import { type Kind } from "./view-configs.js";
export declare const svgKinds: Record<string, Kind>;

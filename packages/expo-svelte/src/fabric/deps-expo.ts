// `expo-modules-core` (its JavaScript side: module proxies, event emitter, shared objects), shown as the "expo-core" phase.
import { mark } from "../boot-marks.ts";
import { requireOptionalNativeModule } from "expo-modules-core";
mark("expo-core");
export { requireOptionalNativeModule };

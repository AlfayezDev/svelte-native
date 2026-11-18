// The React Native module the host needs before the first mount, imported first so its evaluation shows as the "rn" boot
// phase. View configs and the attribute payload are the host's own (`view-configs.ts`); asset resolution loads with the
// first image.
import { mark } from "../boot-marks.ts";
import Platform from "react-native/Libraries/Utilities/Platform";
mark("rn");

type ResolveAssetSource = typeof import("react-native/Libraries/Image/resolveAssetSource").default;
const resolveAssetSource: ResolveAssetSource = (source) =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require("react-native/Libraries/Image/resolveAssetSource") as { default: ResolveAssetSource }).default(source);
// Modules only the gesture host reads; they load with the first gesture, never at boot.
/* eslint-disable @typescript-eslint/no-require-imports */
const turboModuleRegistry = () => require("react-native/Libraries/TurboModule/TurboModuleRegistry") as typeof import("react-native/Libraries/TurboModule/TurboModuleRegistry");
type DeviceEventEmitter = { addListener(name: string, listener: (event: never) => void): { remove(): void } };
const deviceEventEmitter = () => (require("react-native/Libraries/EventEmitter/RCTDeviceEventEmitter") as { default: DeviceEventEmitter }).default;
/* eslint-enable @typescript-eslint/no-require-imports */
type PixelRatio = { get(): number; roundToNearestPixel(size: number): number };
// eslint-disable-next-line @typescript-eslint/no-require-imports -- an `<hr>` is the first to ask
const pixelRatio = () => (require("react-native/Libraries/Utilities/PixelRatio") as { default: PixelRatio }).default;
type Appearance = { getColorScheme(): string | null | undefined; addChangeListener(listener: () => void): { remove(): void } };
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the first text with no colour of its own asks (`host.ts`, `withInk`)
const appearance = () => require("react-native/Libraries/Utilities/Appearance") as Appearance;
export { resolveAssetSource, Platform, turboModuleRegistry, deviceEventEmitter, pixelRatio, appearance };

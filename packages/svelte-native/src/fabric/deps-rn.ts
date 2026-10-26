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
export { resolveAssetSource, Platform };

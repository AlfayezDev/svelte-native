import { nativeBlobOf } from "./blob.ts";
import { native } from "./module.ts";

type UrlStatics = { createObjectURL?: (blob: unknown) => string; revokeObjectURL?: (url: unknown) => void };

/**
 * `URL.createObjectURL(blob)` for one of our Blobs is the `file://` URL native code keeps its bytes under (an image, a video or a WebView loads it like any local file), and
 * `URL.revokeObjectURL(url)` deletes that file. Anything else goes to what the runtime had (React Native's Blobs have their own scheme). Expo's `URL` is patched in place: it is a
 * class of its own that code holds a reference to.
 */
export function patchObjectURLs(): void {
  const URLClass = globalThis.URL as unknown as UrlStatics;
  const createObjectURL = URLClass.createObjectURL;
  const revokeObjectURL = URLClass.revokeObjectURL;
  Object.defineProperty(URLClass, "createObjectURL", {
    configurable: true,
    writable: true,
    value(blob: unknown): string {
      const handle = nativeBlobOf(blob);
      if (handle !== undefined) return handle.objectURL();
      if (createObjectURL === undefined) throw new TypeError("Failed to execute 'createObjectURL' on 'URL': Overload resolution failed.");
      return createObjectURL.call(URLClass, blob);
    },
  });
  Object.defineProperty(URLClass, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value(url: unknown): void {
      native().revokeObjectURL(String(url));
      revokeObjectURL?.call(URLClass, url);
    },
  });
}

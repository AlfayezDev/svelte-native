/**
 * `globalThis.crypto` on the device: the members of the web's `Crypto` that react-native-quick-crypto (a Nitro module with OpenSSL behind it, vendored: `vendor/react-native-quick-crypto`) implements,
 * `getRandomValues`, `randomUUID` and `subtle` (the Web Crypto API: digests, HMAC, AES, RSA, ECDSA, key derivation, ...). `polyfills.ts` defines the global lazily: the library's JavaScript
 * is not loaded, and Nitro not started, until `crypto` is read.
 *
 * Only `crypto` is defined. quick-crypto's own `install()` also sets `Buffer` and is not called. Evaluating the library does two things outside its own exports, which no
 * choice here avoids: it sets `process.nextTick` (to `setImmediate`) when there is none, for its asynchronous calls (React Native's own `process` exists already; the library adds that one
 * member), and its Buffer imports react-native-quick-base64, which defines the globals `base64FromArrayBuffer` and `base64ToArrayBuffer` when it loads. Both happen on the first read of `crypto`, not before.
 */
import { mark } from "./boot-marks.ts";

/**
 * Loads react-native-quick-crypto (the library's own copy) and makes the `Crypto` object from the three members of its exports that `crypto` is made of (its default export is the
 * whole of Node's `crypto`, which `import "crypto"` reaches through Metro). A failure to load it says what to do, since it is a native module the build does not have far more often
 * than a bug: the package is part of the library, so an app that lacks it is a build made before it was added, or one whose prebuild did not link it.
 */
export function loadCrypto(): Crypto {
  let quick: Crypto;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- required on the first read of `crypto`
    quick = require("#vendor/react-native-quick-crypto") as Crypto;
  } catch (cause) {
    throw new Error("`crypto` needs react-native-quick-crypto, which comes with @alfayez/svelte-native, and it could not be loaded: its native module is not in this build. Run `svelte-native doctor`, then prebuild and rebuild the app so that the library's native modules are linked.", { cause });
  }
  const crypto: Crypto = { getRandomValues: quick.getRandomValues, randomUUID: quick.randomUUID, subtle: quick.subtle };
  Object.defineProperty(crypto, Symbol.toStringTag, { value: "Crypto", configurable: true });
  mark("crypto");
  return crypto;
}

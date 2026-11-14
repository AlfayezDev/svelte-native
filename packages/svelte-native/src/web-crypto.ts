/**
 * `globalThis.crypto` on the device: the members of the web's `Crypto` that react-native-quick-crypto (a Nitro module with OpenSSL behind it) implements,
 * `getRandomValues`, `randomUUID` and `subtle` (the Web Crypto API: digests, HMAC, AES, RSA, ECDSA, key derivation, ...). `polyfills.ts` defines the global lazily: the library's JavaScript
 * is not loaded, and Nitro not started, until `crypto` is read.
 *
 * Only `crypto` is defined. quick-crypto's own `install()` also sets `Buffer` and is not called. Evaluating the library does two things outside its own exports, which no
 * choice here avoids: it sets `process.nextTick` (to `setImmediate`) when there is none, for its asynchronous calls (React Native's own `process` exists already; the library adds that one
 * member), and its Buffer imports react-native-quick-base64, which defines the globals `base64FromArrayBuffer` and `base64ToArrayBuffer` when it loads. Both happen on the first read of `crypto`, not before.
 */
import { mark } from "./boot-marks.ts";

/**
 * Loads react-native-quick-crypto and makes the `Crypto` object from the three members of its exports that `crypto` is made of (its default export is the whole of Node's
 * `crypto`, which `import "crypto"` reaches through Metro). A failure to load it says what to do, since it is a missing native module far more often than a bug.
 */
export function loadCrypto(): Crypto {
  let quick: Crypto;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- required on the first read of `crypto`
    quick = require("react-native-quick-crypto") as Crypto;
  } catch (cause) {
    throw new Error("`crypto` needs react-native-quick-crypto, a peer dependency of @alfayez/svelte-native that `svelte-native init` installs, and it could not be loaded: run `svelte-native doctor`, then rebuild the app so that its native module is linked.", { cause });
  }
  const crypto: Crypto = { getRandomValues: quick.getRandomValues, randomUUID: quick.randomUUID, subtle: quick.subtle };
  Object.defineProperty(crypto, Symbol.toStringTag, { value: "Crypto", configurable: true });
  mark("crypto");
  return crypto;
}

# react-native-quick-crypto

- **Current**: 1.1.3
- **Linked**: every app
- **Upstream**: https://github.com/margelo/react-native-quick-crypto
- **Copy**: `vendor/react-native-quick-crypto/` (its `VENDOR.md` has the tarball's integrity, what was left out and the patches)

Follow `README.md` in this directory; this file is what is particular to this package.

## What the library uses it for

`crypto` (`getRandomValues`, `randomUUID`, `subtle`) and the Node `crypto` module that libraries import (`src/polyfills.ts`, `src/web-crypto.ts`; Metro resolves `crypto` and `node:crypto` to it).

## Coupled with

react-native-nitro-modules (see its file) and react-native-quick-base64 (its peer, `>=2.1.0`).

## Version policy

The newest 1.x that supports the group's runtime. Security fixes, here or in OpenSSL, are taken as soon as the group allows.

## Local changes

None. The copy leaves out its Expo plugin (`app.plugin.js`, `src/expo-plugin`, `lib/typescript/expo-plugin`) and the built `lib/commonjs` and `lib/module` (Metro reads `src`).

## What the library relies on

- The library's plugin re-implements the one option apps used from quick-crypto's own plugin, `sodiumEnabled` (`applyGradleSodium` and `applyPodfileSodium` in `src/expo.ts`): compare the new version's `src/expo-plugin` with them, and carry over any change in what it writes.
- Its JavaScript `dependencies` (`@craftzdog/react-native-buffer`, `events`, `readable-stream`, `safe-buffer`, `string_decoder`, `util`) are the library's `dependencies`: a new or changed one is changed there too.
- `src/autolinking.ts`: `DeferredNitroPackage("QuickCrypto")`.
- `src/web-crypto.ts` and `src/polyfills.ts`: which APIs are installed as globals, by name.

## What to look at in its source

- OpenSSL and libsodium versions (below): security-relevant on every update.
- How libsodium reaches the build when `sodiumEnabled` is on: on iOS the podspec downloads `libsodium-1.0.20-stable.tar.gz` from download.libsodium.org with `curl` while CocoaPods evaluates it, with no checksum, into `ios/libsodium-stable` (the published files leave that directory out); on Android it is the Maven artifact below. A changed URL, version or a new download is a red flag; a checksum check would be a welcome local patch.

## Native dependencies downloaded at build time

The pod `OpenSSL-Universal` (`~> 3.6`) and the Maven artifacts `io.github.ronickg:openssl:3.6.0-1` and `io.github.ronickg:sodium:1.0.20-1`. Check OpenSSL's advisories for the version they resolve to.

## Proof

- The example's Web APIs screen opened with `?checks=<origin>` (`apps/example/src/lib/web-api-checks.ts`: digests, `randomUUID`, `subtle`) on both platforms.
- A build with `sodiumEnabled: true` and one without, on both platforms.

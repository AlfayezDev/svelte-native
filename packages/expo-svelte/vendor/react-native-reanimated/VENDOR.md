# react-native-reanimated 4.7.1 (vendored)

Third-party code, copied into this package (VENDORING.md). Nothing here is edited by hand: `node scripts/vendor.ts react-native-reanimated@4.7.1 --exclude 'lib/**/*.map' --exclude android/gradle --exclude android/gradlew --exclude android/gradlew.bat` (in packages/expo-svelte) writes this directory again, byte for byte.

- Upstream: `react-native-reanimated` 4.7.1 on npm, repository https://github.com/software-mansion/react-native-reanimated
- Tarball: `npm pack react-native-reanimated@4.7.1`, 1092346 bytes, 2439 files
- Integrity (npm's `dist.integrity`): `sha512-HviDFSZ6V4KTRsrLS6hRbBJ4j63l/L8a5az0EoWdJwaMLYnBNyYISTDxwXpEYkMbAbLzCMCviIdiOxXHYQWcNA==`
- sha256: `fedb57534cd43865d76128ae91b23795b9cecdba511ff056f0fd5a0ea656219b`
- License: `LICENSE` from the tarball, sha256 `f1ae22eddd3a96c3b7b8a494ef03749ae6a1e19574bacc9c195d83c916de09e2`

## Left out

- `lib/**/*.map`
- `android/gradle`
- `android/gradlew`
- `android/gradlew.bat`

## Local changes

- `vendor-patches/react-native-reanimated/0001-engine-views-and-direct-props.patch` (sha256 `16f360c4127fc445af44b480897f82aff6ca67ef0f342b7c0ca28ed37688ffef`), applied with `patch -p1` after the unpack
- `vendor-patches/react-native-reanimated/0002-worklets-is-the-copy-beside-it.patch` (sha256 `b0de1f0153ba41f29cb331e1c0f4904221890a45f34dcece607385a2852a9fe5`), applied with `patch -p1` after the unpack
- `vendor-patches/react-native-reanimated/0003-android-synchronous-props-on-by-default.patch` (sha256 `815dad641b08734716430761d48c7c1ab83e7c4192c8f14e590b2a57b3e4fcb4`), applied with `patch -p1` after the unpack
- `vendor-patches/react-native-reanimated/0004-keyboard-events-from-the-engine.patch` (sha256 `5615055d3466dba978c2a28add2bfe76e25896baf4a82c8fca276e8a31c0f884`), applied with `patch -p1` after the unpack

# react-native-reanimated 4.5.1 (vendored)

Third-party code, copied into this package (VENDORING.md). Nothing here is edited by hand: `node scripts/vendor.ts react-native-reanimated@4.5.1 --exclude 'lib/**/*.map' --exclude android/gradle --exclude android/gradlew --exclude android/gradlew.bat` (in packages/expo-svelte) writes this directory again, byte for byte.

- Upstream: `react-native-reanimated` 4.5.1 on npm, repository https://github.com/software-mansion/react-native-reanimated
- Tarball: `npm pack react-native-reanimated@4.5.1`, 974646 bytes, 2157 files
- Integrity (npm's `dist.integrity`): `sha512-RnMvtDuR+68ig864gAvZCOdZehqhC5rFmMo0kn+ARfgVSTvFeF6IFLBVgMPUu0KwihaapEyW24WRi6nEyy1kSA==`
- sha256: `92ef1dbaf65888bcba91ed6589ab8cdd96bb0853c707524dba79c05f0800186f`
- License: `LICENSE` from the tarball, sha256 `f1ae22eddd3a96c3b7b8a494ef03749ae6a1e19574bacc9c195d83c916de09e2`

## Left out

- `lib/**/*.map`
- `android/gradle`
- `android/gradlew`
- `android/gradlew.bat`

## Local changes

- `vendor-patches/react-native-reanimated/0001-engine-views-and-direct-props.patch` (sha256 `4316654f8fff4be7db8b6963ebd088b4c84edbf8e9123cd2b2145ee299b20efa`), applied with `patch -p1` after the unpack
- `vendor-patches/react-native-reanimated/0002-worklets-is-the-copy-beside-it.patch` (sha256 `bede8cff3d5bc61c28bc803e934cd0287d521ac3627caba8e6fa039d39c496e7`), applied with `patch -p1` after the unpack
- `vendor-patches/react-native-reanimated/0003-android-synchronous-props-on-by-default.patch` (sha256 `815dad641b08734716430761d48c7c1ab83e7c4192c8f14e590b2a57b3e4fcb4`), applied with `patch -p1` after the unpack

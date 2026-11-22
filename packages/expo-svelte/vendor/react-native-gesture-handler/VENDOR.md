# react-native-gesture-handler 3.3.0 (vendored)

Third-party code, copied into this package (VENDORING.md). Nothing here is edited by hand: `node scripts/vendor.ts react-native-gesture-handler@3.3.0 --exclude 'lib/**/*.map' --exclude jest-utils --exclude jestSetup.js` (in packages/expo-svelte) writes this directory again, byte for byte.

- Upstream: `react-native-gesture-handler` 3.3.0 on npm, repository https://github.com/software-mansion/react-native-gesture-handler
- Tarball: `npm pack react-native-gesture-handler@3.3.0`, 706486 bytes, 1368 files
- Integrity (npm's `dist.integrity`): `sha512-ZCTlJ09nE3GPbm7J74lvwpxmx1TQ/7MDlHZNLARVYTN82k21mJUJ7BmI9eWjEi8eevHiAudI5O1Cpnt0rJfoJA==`
- sha256: `8131abc0af4b91814046225d4e0cfe7b6d2e8d04e5ea486e5e061087d7bc1681`
- License: `LICENSE` from the tarball, sha256 `f1ae22eddd3a96c3b7b8a494ef03749ae6a1e19574bacc9c195d83c916de09e2`

## Left out

- `lib/**/*.map`
- `jest-utils`
- `jestSetup.js`

## Local changes

- `vendor-patches/react-native-gesture-handler/0001-root-recognizer-for-presented-screens.patch` (sha256 `2256f1204acf01972ee8ed6a642aaad629a57186fc6b5b30e464549e64407b8a`), applied with `patch -p1` after the unpack

# react-native-gesture-handler 2.32.0 (vendored)

Third-party code, copied into this package (VENDORING.md). Nothing here is edited by hand: `node scripts/vendor.ts react-native-gesture-handler@2.32.0 --exclude 'lib/**/*.map' --exclude lib/commonjs --exclude jest-utils --exclude jestSetup.js` (in packages/svelte-native) writes this directory again, byte for byte.

- Upstream: `react-native-gesture-handler` 2.32.0 on npm, repository https://github.com/software-mansion/react-native-gesture-handler
- Tarball: `npm pack react-native-gesture-handler@2.32.0`, 624541 bytes, 1266 files
- Integrity (npm's `dist.integrity`): `sha512-uYIMOKlKENORq2SABE+jIjbPU+h5I/sQKcq2v16zRq848nwEp1fWRVwML4QWqijc8UcXJC25o54S8GQd4Mf2OA==`
- sha256: `07f8dd26291880e0fa8e397c0c221acb6889a9830d44dcb1de4d44f8cb462338`
- License: `LICENSE` from the tarball, sha256 `f1ae22eddd3a96c3b7b8a494ef03749ae6a1e19574bacc9c195d83c916de09e2`

## Left out

- `lib/**/*.map`
- `lib/commonjs`
- `jest-utils`
- `jestSetup.js`

## Local changes

- `vendor-patches/react-native-gesture-handler/0001-root-recognizer-for-presented-screens.patch` (sha256 `80814f1579736b80c11a7fdbf3cec025bd10413038c6c3fbdbaf774969c9d9ca`), applied with `patch -p1` after the unpack

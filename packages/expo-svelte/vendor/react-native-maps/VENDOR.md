# react-native-maps 1.27.2 (vendored)

Third-party code, copied into this package (VENDORING.md). Nothing here is edited by hand: `node scripts/vendor.ts react-native-maps@1.27.2 --exclude dist/tsconfig.build.tsbuildinfo` (in packages/expo-svelte) writes this directory again, byte for byte.

- Upstream: `react-native-maps` 1.27.2 on npm, repository https://github.com/react-native-maps/react-native-maps
- Tarball: `npm pack react-native-maps@1.27.2`, 352881 bytes, 388 files
- Integrity (npm's `dist.integrity`): `sha512-VKr+xZ2RZGHHJlY6KhlafvGSmK0dq/tUu5uhfJ7K9rwN5pUdubdugzMKGDU/16lXmQSg7xbClKhRctj3Pm5F5g==`
- sha256: `5c118ad7813402e7763dd9b97c2068fdc1bfc46a45e698c0e8a3aa010b4591b0`
- License: `LICENSE` from the tarball, sha256 `4099a1a5146930614f6c88cab3d38676d460e0e349f3743693ade20e4407587e`

## Left out

- `dist/tsconfig.build.tsbuildinfo`

## Local changes

- `vendor-patches/react-native-maps/0001-deliver-discrete-events-one-by-one.patch` (sha256 `1ffa4c63d3c0fae9aceedbef730c1e7749d9cb87fa6b076803f00e34df88cab7`), applied with `patch -p1` after the unpack
- `vendor-patches/react-native-maps/0002-the-podfile-finds-the-copy.patch` (sha256 `f4e553e700602b3e66e3ef361e3918c9436519a0ac884a2b1e3b9e2fd07dfcfa`), applied with `patch -p1` after the unpack

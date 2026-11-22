# react-native-maps 1.29.11 (vendored)

Third-party code, copied into this package (VENDORING.md). Nothing here is edited by hand: `node scripts/vendor.ts react-native-maps@1.29.11 --exclude dist/tsconfig.build.tsbuildinfo` (in packages/expo-svelte) writes this directory again, byte for byte.

- Upstream: `react-native-maps` 1.29.11 on npm, repository https://github.com/react-native-maps/react-native-maps
- Tarball: `npm pack react-native-maps@1.29.11`, 364882 bytes, 396 files
- Integrity (npm's `dist.integrity`): `sha512-fZNc6AINuPdHS2puudanNPd9ZMPPuerTHfy9HU6LbpOD+kB03SuOZRbOEYIOE2eSuUPYwLHvU8ys1RcSIxLYhA==`
- sha256: `5874f46812fcf3b7a9fc17bd0fa775e3c0c4db711ce66d0bbec6c01fcca60e5e`
- License: `LICENSE` from the tarball, sha256 `4099a1a5146930614f6c88cab3d38676d460e0e349f3743693ade20e4407587e`

## Left out

- `dist/tsconfig.build.tsbuildinfo`

## Local changes

- `vendor-patches/react-native-maps/0001-deliver-discrete-events-one-by-one.patch` (sha256 `1ffa4c63d3c0fae9aceedbef730c1e7749d9cb87fa6b076803f00e34df88cab7`), applied with `patch -p1` after the unpack
- `vendor-patches/react-native-maps/0002-the-podfile-finds-the-copy.patch` (sha256 `f4e553e700602b3e66e3ef361e3918c9436519a0ac884a2b1e3b9e2fd07dfcfa`), applied with `patch -p1` after the unpack

# react-native-pdf 7.0.3 (vendored)

Third-party code, copied into this package (VENDORING.md). Nothing here is edited by hand: `node scripts/vendor.ts react-native-pdf@7.0.3 --exclude android/.gradle --exclude windows` (in packages/expo-svelte) writes this directory again, byte for byte.

- Upstream: `react-native-pdf` 7.0.3 on npm, repository https://github.com/wonday/react-native-pdf
- Tarball: `npm pack react-native-pdf@7.0.3`, 95355 bytes, 63 files
- Integrity (npm's `dist.integrity`): `sha512-zDtF6CGXPAfGptQZqX7LQK3CVQrIGsD+rYuBnMK0sVmd8mrq7ciwmWXINT+d92emMtZ7+PLnx1IQZIdsh0fphA==`
- sha256: `1281cb8b102b7875cb3408c8c27966b20d7443a6856a9ce2c50b1d7578f73804`
- License: `LICENSE` from the tarball, sha256 `f1d53dc2a77870c9890a727009cbcf1f7c886a3932cfbf090304b9e7f2a6b000`

## Left out

- `android/.gradle`
- `windows`

## Local changes

- `vendor-patches/react-native-pdf/0001-deliver-every-message.patch` (sha256 `106b7cb70a12e7a81696216d27c6bcd62cec8f3ca9810112dfc154db430571ee`), applied with `patch -p1` after the unpack
- `vendor-patches/react-native-pdf/0002-find-react-native-from-the-app.patch` (sha256 `429cfc8777b99a378bc3265fe2d4f21ccfc8d9596d3329c213b64a8d3b092ee1`), applied with `patch -p1` after the unpack

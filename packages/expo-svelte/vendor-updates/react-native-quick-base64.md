# react-native-quick-base64

- **Current**: 2.2.2
- **Linked**: every app
- **Upstream**: https://github.com/craftzdog/react-native-quick-base64
- **Copy**: `vendor/react-native-quick-base64/` (its `VENDOR.md` has the tarball's integrity, what was left out and the patches)

Follow `README.md` in this directory; this file is what is particular to this package.

## What the library uses it for

The native base64 module quick-crypto and its Buffer (`@craftzdog/react-native-buffer`) ask for; `btoa` and `atob` go through it.

## Coupled with

react-native-quick-crypto (its peer range, `>=2.1.0`).

## Version policy

The newest 2.x within quick-crypto's peer range.

## Local changes

None.

## What the library relies on

- Metro resolves its name to the copy for every importer: the Buffer package, which a package manager also installs an original of beside the library (inert; nothing links or bundles it).

## What to look at in its source

- Its native module's name and JSI install call: quick-crypto and the Buffer package call them.

## Native dependencies downloaded at build time

None.

## Proof

- `btoa`/`atob` and a Buffer base64 round trip on both platforms (the Web APIs screen's checks, and a line of your own in the example app if they do not cover the case the update touches).

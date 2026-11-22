# hermes-intl

- **Current**: 0.1.2
- **Linked**: every app
- **Upstream**: https://github.com/magrinj/hermes-intl
- **Copy**: `vendor/hermes-intl/` (its `VENDOR.md` has the tarball's integrity, what was left out and the patches)

Follow `README.md` in this directory; this file is what is particular to this package.

## What the library uses it for

The `Intl` constructors Hermes lacks: `PluralRules`, `RelativeTimeFormat`, `ListFormat`, `Locale` (`src/intl.ts`).

## Coupled with

None, but React Native's Hermes: a Hermes release that has these constructors makes the package unnecessary, which `src/intl.ts` must notice (it installs a constructor only where Hermes has none).

## Version policy

The newest release, after the binary check below. Also check at every React Native update whether Hermes now has the constructors; if it has all four, the package can go.

## Local changes

None.

## What the library relies on

- `src/intl.ts`: which constructors it installs and how it loads the package.
- The doctor and Metro name it (`src/doctor/checks.ts`, `src/metro.ts`).

## What to look at in its source

- **Prebuilt binaries**: about 9 MB of ICU4X libraries under `prebuilt/` (an iOS XCFramework, Android shared libraries). They cannot be reviewed as source. Tie each one to the upstream build (release assets with checksums, or a build from the tagged Rust sources that gives the same bytes); a changed binary without that is a red flag that stops the update.
- The locale data the binaries carry (size and locales): the package's size is part of the library's.

## Native dependencies downloaded at build time

The prebuilt ICU4X libraries above; nothing downloaded at build time.

## Proof

- The Web APIs screen's `Intl` check (`apps/example/src/lib/web-api-checks.ts`: Arabic plural rules, relative time, list format, locale) and the example's i18n screen, on both platforms.

#!/usr/bin/env bash
# Shared by scripts/consumer-check.sh and scripts/new-app.sh. Sourced, never run: it only defines functions.
#
# Both scripts make an app outside this repository from examples/minimal and set it up as packages/svelte-native/README.md says ("Install
# in an app", "Apply the patches"); these are the steps they have in common, so there is one way of doing them:
#
#   sn_cap_init <auto|none>           CAP, the pnpm flags (OFFLINE=1), and the `cap` runner for heavy commands
#   sn_template_copy <template> <app> <aside>
#                                     copy the template; set its patchedDependencies block aside (the app before "Apply the patches")
#   sn_install <app> <library> <svelte>
#                                     pnpm add the library and Svelte (the first install: the patch files arrive with the library)
#   sn_patches_apply <app> <aside>    copy the patch files from the installed library, declare them, install again, check the lockfile
#
# The caller sets nothing but the arguments (and `set -euo pipefail` where it wants the functions to stop at the first failure). Every
# function that changes directory does so for its caller too; call it from a subshell when that matters.

die() { echo "error: $*" >&2; exit 1; }

# sn_cap_init <auto|none>: sets cap_prefix and pnpm_flags and defines `cap`, the prefix of every heavy command.
#   CAP="<prefix>"  the prefix itself; CAP= (empty) runs bare
#   auto            without CAP: `systemd-run --user --scope ... nice ionice` when systemd-run works, else `nice -n 19` (a shared PC)
#   none            without CAP: bare (a person's own machine)
#   OFFLINE=1       pnpm --offline (the store must already hold everything), else pnpm --prefer-offline
sn_cap_init() {
  if [ "${CAP+set}" = set ]; then
    read -r -a cap_prefix <<<"$CAP"
  elif [ "${1:-auto}" = none ]; then
    cap_prefix=()
  elif command -v systemd-run >/dev/null 2>&1 && systemd-run --user --scope --quiet true >/dev/null 2>&1; then
    cap_prefix=(systemd-run --user --scope --quiet -p CPUQuota=600% -p MemoryHigh=16G nice -n 19 ionice -c3)
  else
    cap_prefix=(nice -n 19)
  fi
  pnpm_flags=(--prefer-offline)
  if [ "${OFFLINE:-}" = 1 ]; then pnpm_flags=(--offline); fi
}
# The empty-array form: an empty cap_prefix must not be an unbound variable (bash 3.2 and 4.3 under `set -u`).
cap() { ${cap_prefix[@]+"${cap_prefix[@]}"} "$@"; }

# sn_spec_of <app> <dependency>: the version specifier the app's package.json has for a dependency ("" when it has none).
sn_spec_of() { node -e 'const p=require(process.argv[1]);console.log((p.dependencies||{})[process.argv[2]]||"")' "$1/package.json" "$2"; }

# sn_template_copy <template> <app> <aside>: copies the template to <app> without what a build or an install leaves in it, and writes the
# patchedDependencies block of its pnpm-workspace.yaml to <aside> instead of to the app: the patch files do not exist until the library is
# installed, and pnpm reads them before it fetches anything (README, "Apply the patches").
sn_template_copy() {
  local template=$1 app=$2 aside=$3
  mkdir -p "$app"
  tar -C "$template" -cf - --exclude=node_modules --exclude=.svelte-native --exclude=android --exclude=ios --exclude=.expo . | tar -C "$app" -xf -
  # The app before "Apply the patches": the block is the last of the file, set aside and declared by sn_patches_apply.
  awk '/^patchedDependencies:/ { exit } { print }' "$template/pnpm-workspace.yaml" >"$app/pnpm-workspace.yaml"
  awk '/^patchedDependencies:/ { found = 1 } found { print }' "$template/pnpm-workspace.yaml" >"$aside"
  [ -s "$aside" ] || die "examples/minimal/pnpm-workspace.yaml has no patchedDependencies block"
  awk 'NR > 1 && NF && !/^ / { exit 1 }' "$aside" || die "patchedDependencies must be the last block of examples/minimal/pnpm-workspace.yaml"
  # Nothing the app is made of reaches into this repository: no relative path out of it, no workspace/link/file specifier, no import of the library by path.
  if grep -rnE '\.\./|packages/svelte-native|apps/(example|qa)' "$app/src" "$app/metro.config.cjs" "$app/app.json"; then die "the template points into the repository"; fi
  if grep -nE '"(workspace|link|file):' "$app/package.json"; then die "the template's package.json has a workspace:, link: or file: specifier"; fi
  echo "template: $(find "$app" -type f | wc -l) files, $(($(wc -l <"$aside") - 1)) patches to declare"
}

# sn_install <app> <library> <svelte>: `pnpm add` of the library and of the custom-renderer Svelte, run in the app. <library> is a tarball or
# a git dependency (`git+ssh://...#<ref>&path:packages/svelte-native`), <svelte> a tarball or `svelte@<url>`.
sn_install() {
  local app=$1 library=$2 svelte=$3
  cd "$app" || die "$app: no such directory"
  echo "+ pnpm add $library $svelte"
  cap pnpm add "${pnpm_flags[@]}" "$library" "$svelte" || die "pnpm add failed"
  echo "package.json: \"@example/svelte-native\": \"$(sn_spec_of "$app" @example/svelte-native)\""
  echo "package.json: \"svelte\": \"$(sn_spec_of "$app" svelte)\""
  [ -f node_modules/@example/svelte-native/package.json ] || die "node_modules/@example/svelte-native is missing"
  [ -f node_modules/@example/svelte-native/expo-module.config.json ] || die "the installed library has no expo-module.config.json"
}

# sn_patches_apply <app> <aside>: README, "Apply the patches": copy the files, declare them (<aside> is the block sn_template_copy set aside),
# install again, and check that every declared patch is in the lockfile.
sn_patches_apply() {
  local app=$1 aside=$2 declared key
  cd "$app" || die "$app: no such directory"
  mkdir -p patches/svelte-native
  cp node_modules/@example/svelte-native/patches/*.patch patches/svelte-native/ || die "the installed library has no patch files"
  echo "copied $(find patches/svelte-native -type f | wc -l) patch files"
  cat "$aside" >>pnpm-workspace.yaml
  # Declaring the patches changes the lockfile; with CI=1 pnpm would refuse ("frozen installation"), so the first install after the declaration is not frozen.
  cap pnpm install --no-frozen-lockfile "${pnpm_flags[@]}" || die "pnpm install failed"
  declared=$(sed -n 's/^  "\{0,1\}\([^":]*[^":]\)"\{0,1\}: patches.*/\1/p' "$aside")
  [ -n "$declared" ] || die "no patch declared"
  for key in $declared; do
    grep -qF "$key" <(sed -n '/^patchedDependencies:/,/^$/p' pnpm-lock.yaml) || die "$key is not in the lockfile's patchedDependencies"
    echo "patched: $key"
  done
}

#!/usr/bin/env bash
# Makes a new Svelte Native app that is ready to run: the starter for the early preview.
#
#   scripts/new-app.sh <dir> [--ref <tag|branch|commit>] [--local]
#
# It copies examples/minimal (the smallest working app) to <dir>, which must not exist yet or must be empty, and does what
# packages/svelte-native/README.md ("Install in an app", "Apply the patches") tells an app to do, the way scripts/consumer-check.sh does it
# in its git mode (the steps are in scripts/lib/app-setup.sh):
#
#   1. checks node, pnpm and git, and that the private repository can be read (over SSH)
#   2. copies the template, named after <dir>, without its patchedDependencies block
#   3. pnpm add of the library, as a git dependency over SSH, and of the custom-renderer Svelte, from pkg.pr.new
#   4. copies the library's patch files into the app, declares them in pnpm-workspace.yaml and installs again
#   5. runs `svelte-native doctor`
#
# and prints the commands to run next. Nothing is built: the first `pnpm android` / `pnpm ios` builds the native app.
#
# Options:
#   --ref <ref>   the tag, branch or commit of the repository the app depends on. Default: the newest tag `v*` of the repository this
#                 script is run from (`git describe`), or, in a shallow clone that has no tags, of the repository on GitHub.
#   --local       for testing the script, or working without a network: depend on this checkout (git+file://<checkout>#<commit>) and install
#                 Svelte from the tarball in vendor/ instead of pkg.pr.new. The default ref is the checkout's HEAD commit.
#   -h, --help    this text
#
# Environment:
#   OFFLINE=1     pnpm --offline (the store must already hold everything)
#   CAP="<prefix>" a prefix for the heavy commands (pnpm), for example `nice -n 19`; none by default
#
# From a clone, or without keeping one (the app does not refer to the clone; delete it afterwards):
#   git clone --depth 1 git@github.com:AlfayezDev/svelte-native.git /tmp/svelte-native && /tmp/svelte-native/scripts/new-app.sh my-app
#
# Works with bash 3.2 (macOS) and later.
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
template=$repo/examples/minimal
# shellcheck source-path=SCRIPTDIR source=lib/app-setup.sh
. "$repo/scripts/lib/app-setup.sh"
sn_cap_init none

repo_url=git+ssh://git@github.com/AlfayezDev/svelte-native.git
# The comment block at the top of this file.
usage() { awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "${BASH_SOURCE[0]}"; }
usage_error() { echo "new-app.sh: $*" >&2; echo "usage: scripts/new-app.sh <dir> [--ref <tag|branch|commit>] [--local]   (--help for the details)" >&2; exit 2; }

dir=
ref=
use_local=0
while [ $# -gt 0 ]; do
  case $1 in
    -h|--help) usage; exit 0 ;;
    --ref) [ $# -ge 2 ] || usage_error "--ref needs a tag, branch or commit"; ref=$2; shift 2 ;;
    --ref=*) ref=${1#--ref=}; shift ;;
    --local) use_local=1; shift ;;
    -*) usage_error "unknown option $1" ;;
    *) [ -z "$dir" ] || usage_error "one directory only (got $dir and $1)"; dir=$1; shift ;;
  esac
done
[ -n "$dir" ] || usage_error "which directory? scripts/new-app.sh <dir>"

# ---- the directory -----------------------------------------------------------------------------------------------------------------------
# Absolute, with the symlinks of the part that exists resolved, so that "inside the repository" is judged on the real path.
case $dir in /*) ;; *) dir=$PWD/$dir ;; esac
while [ "$dir" != / ] && [ "${dir%/}" != "$dir" ]; do dir=${dir%/}; done
[ ! -e "$dir" ] || [ -d "$dir" ] || die "$dir exists and is not a directory"
if [ -d "$dir" ] && [ -n "$(ls -A "$dir")" ]; then
  die "$dir already exists and is not empty.
new-app.sh makes a new app: give it a directory that does not exist yet (or is empty), or remove $dir first."
fi
existing=$dir
rest=
while [ ! -e "$existing" ]; do rest=/$(basename "$existing")$rest; existing=$(dirname "$existing"); done
dir=$(cd "$existing" && pwd -P)$rest
case "$dir/" in "$repo"/*) die "$dir is inside the repository checkout ($repo). Make the app outside it, for example next to it." ;; esac

# ---- the tools ---------------------------------------------------------------------------------------------------------------------------
# What the repository is built with is what it asks of an app, too: node and pnpm, as the root package.json pins them (the doctor checks the same).
version_ge() { # version_ge <have> <want>: have >= want, comparing the dot-separated numbers
  awk -v have="$1" -v want="$2" 'BEGIN {
    n = split(have, h, "."); m = split(want, w, "."); if (m > n) n = m
    for (i = 1; i <= n; i++) { a = h[i] + 0; b = w[i] + 0; if (a > b) exit 0; if (a < b) exit 1 }
    exit 0
  }'
}
command -v git >/dev/null 2>&1 || die "git is not installed. pnpm installs the library from a git repository, so git is needed (https://git-scm.com/downloads)."
command -v node >/dev/null 2>&1 || die "node is not installed. Svelte Native needs Node $(sed -n 's/^.*"node": *"\([0-9][0-9.]*\)".*$/\1/p' "$repo/package.json" | head -n 1) or newer: install it with mise, fnm or nvm, or from https://nodejs.org."
command -v pnpm >/dev/null 2>&1 || die "pnpm is not installed. Install it with \`npm install -g pnpm\` or see https://pnpm.io/installation (Svelte Native is set up with pnpm 12)."
pins=$(node -e '
  const p = require(process.argv[1]);
  const first = (value) => (String(value || "").match(/\d+(\.\d+)*/) || [""])[0];
  const manager = /^pnpm@/.test(p.packageManager || "") ? p.packageManager.slice(5) : (p.engines || {}).pnpm;
  const node = (p.engines || {}).node || ((p.devEngines || {}).runtime || {}).version;
  console.log(first(node) + " " + first(manager));
' "$repo/package.json")
want_node=${pins% *}
want_pnpm=${pins#* }
have_node=$(node --version)
have_node=${have_node#v}
# From a directory of its own: pnpm switches to the version a project pins (the repository pins its own), and the app is not in the repository.
have_pnpm=$(cd "${TMPDIR:-/tmp}" && pnpm --version 2>/dev/null | tail -n 1 || true)
[ -n "$have_pnpm" ] || die "pnpm is installed but \`pnpm --version\` printed nothing; run it by hand to see why."
if [ -n "$want_node" ] && ! version_ge "$have_node" "$want_node"; then
  die "node $have_node is too old: Svelte Native needs Node $want_node or newer (Node ${want_node%%.*}).
Install it with your version manager (mise use -g node@${want_node%%.*}, nvm install ${want_node%%.*}, fnm install ${want_node%%.*}) or from https://nodejs.org, and open a new shell."
fi
if [ -n "$want_pnpm" ] && ! version_ge "$have_pnpm" "$want_pnpm"; then
  die "pnpm $have_pnpm is too old: Svelte Native needs pnpm $want_pnpm or newer (pnpm ${want_pnpm%%.*}).
Update it with \`npm install -g pnpm@${want_pnpm%%.*}\` (or \`pnpm self-update\`; https://pnpm.io/installation)."
fi
warnings=()
ssh_note=
if [ -n "$want_pnpm" ] && [ "${have_pnpm%%.*}" -gt "${want_pnpm%%.*}" ] 2>/dev/null; then
  warnings+=("pnpm $have_pnpm is newer than the pnpm ${want_pnpm%%.*} line this version was exercised on; if the install fails, try pnpm ${want_pnpm}.")
fi

# ---- the library -------------------------------------------------------------------------------------------------------------------------
work=$(mktemp -d "${TMPDIR:-/tmp}/svelte-native-new-app.XXXXXX")
created=0
finished=0
current="checking the repository"
cleanup() {
  local code=$?
  rm -rf "$work"
  if [ "$code" -ne 0 ] && [ "$finished" = 0 ] && [ "$created" = 1 ]; then
    echo >&2
    echo "new-app.sh: failed while $current (exit $code). The partly made app is in $dir: delete it (rm -rf \"$dir\") and run the script again once that is fixed." >&2
  fi
}
trap cleanup EXIT

if [ "$use_local" = 1 ]; then
  git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 || die "--local needs a git checkout: $repo is not one."
  [ -n "$ref" ] || ref=$(git -C "$repo" rev-parse HEAD)
  git -C "$repo" rev-parse --verify --quiet "$ref^{commit}" >/dev/null || die "--local: $ref is not a commit, tag or branch of $repo."
  library_url=git+file://$repo
  dirty=$(git -C "$repo" status --porcelain -- packages/svelte-native vendor)
  [ -z "$dirty" ] || warnings+=("uncommitted changes in the library; the app depends on the commit $ref, not on the working tree:
$dirty")
  svelte_tgz=$(ls "$repo"/vendor/svelte-*.tgz 2>/dev/null) || die "no vendored svelte tarball in $repo/vendor/"
  [ "$(printf '%s\n' "$svelte_tgz" | wc -l)" -eq 1 ] || die "expected one vendored svelte tarball in $repo/vendor/"
  svelte_arg=./$(basename "$svelte_tgz")
else
  library_url=$repo_url
  plain_url=${repo_url#git+}
  hosted_path=${plain_url#ssh://git@github.com/}
  github_org=${hosted_path%%/*}
  ls_remote() { GIT_TERMINAL_PROMPT=0 git ls-remote "$@"; }
  # One call answers three questions: can this machine read the private repository, what is its newest release, and does the ref exist.
  if refs=$(ls_remote --refs --sort=-v:refname "$plain_url" 2>"$work/ls-remote.err"); then
    # pnpm resolves a github.com dependency over HTTPS whatever its specifier says (it records https://github.com/... in the lockfile, so that the
    # lockfile works on every machine). A machine that reaches the private repository only over SSH has to tell git to use SSH for it. This is
    # done for the processes of this script (git reads GIT_CONFIG_*), not in the person's git config; the later installs in the app need it, too.
    if ! ls_remote --exit-code "https://github.com/$hosted_path" HEAD >/dev/null 2>&1; then
      n=${GIT_CONFIG_COUNT:-0}
      export "GIT_CONFIG_KEY_$n=url.git@github.com:$github_org/.insteadOf" "GIT_CONFIG_VALUE_$n=https://github.com/$github_org/" "GIT_CONFIG_COUNT=$((n + 1))"
      ssh_note="git reaches github.com/$github_org over SSH only, and pnpm resolves GitHub dependencies over HTTPS. For this run git is told to use SSH for it
(nothing in your git config is changed). Installs in the app later on (a fresh \`pnpm install\`, \`pnpm add\`) need the same, once:
  git config --global url.\"git@github.com:$github_org/\".insteadOf \"https://github.com/$github_org/\""
    fi
  elif refs=$(ls_remote --refs --sort=-v:refname "https://github.com/$hosted_path" 2>/dev/null); then
    : # no SSH key, but git reads the repository over HTTPS (a credential helper): pnpm uses the same
  else
    die "cannot read ${plain_url#ssh://} over SSH:
$(sed 's/^/  /' "$work/ls-remote.err")
The repository is private: you need to be invited as a collaborator, and the SSH key you use must be on your GitHub account.
\`ssh -T git@github.com\` should greet you by name, and \`git ls-remote git@github.com:$hosted_path\` is the check this script just made."
  fi
  if [ -z "$ref" ]; then
    ref=$(git -C "$repo" describe --tags --abbrev=0 --match 'v*' 2>/dev/null || true)
  fi
  if [ -z "$ref" ]; then
    # A shallow clone (git clone --depth 1) has no tags of its own: the newest one is on GitHub.
    ref=$(printf '%s\n' "$refs" | sed -n 's|^[0-9a-f]\{40\}[[:space:]]refs/tags/\(v.*\)$|\1|p' | head -n 1)
  fi
  [ -n "$ref" ] || die "no release tag (v*) found in ${plain_url#ssh://}. Pass --ref <tag|branch|commit>."
  # A full or abbreviated commit hash is not in the list of refs; anything else must be a tag or a branch there.
  case $ref in
    *[!0-9a-f]*)
      printf '%s\n' "$refs" | awk -v tag="refs/tags/$ref" -v branch="refs/heads/$ref" '$2 == tag || $2 == branch { found = 1 } END { exit !found }' \
        || die "${plain_url#ssh://} has no tag or branch $ref. Its releases:
$(printf '%s\n' "$refs" | sed -n 's|^[0-9a-f]\{40\}[[:space:]]refs/tags/|  |p')" ;;
  esac
  svelte_spec=$(sn_spec_of "$template" svelte)
  case $svelte_spec in https://pkg.pr.new/svelte@*) ;; *) die "examples/minimal names Svelte as '$svelte_spec', not a pkg.pr.new build; this script installs what the template names." ;; esac
  svelte_arg=svelte@$svelte_spec
fi
library_spec="$library_url#$ref&path:packages/svelte-native"
# The app is made from this checkout's template and the library of <ref>: tell the person when the two are not the same version.
if git -C "$repo" rev-parse --verify --quiet "$ref^{commit}" >/dev/null 2>&1 && ! git -C "$repo" diff --quiet "$ref" -- examples/minimal vendor 2>/dev/null; then
  warnings+=("this checkout's examples/minimal differs from the one at $ref; the app is made from this checkout's, with the library at $ref.
If the install fails on a version mismatch, \`git -C $repo checkout $ref\` and run the script again.")
fi

# ---- the steps ---------------------------------------------------------------------------------------------------------------------------
started=$SECONDS
step_started=$SECONDS
begin() { current=$1; step_started=$SECONDS; printf '\n==> %s\n' "$1"; }
timings=
finish() {
  printf '    done in %s s\n' "$((SECONDS - step_started))"
  timings="$timings$(printf '  %-58s %4s s' "$current" "$((SECONDS - step_started))")"$'\n'
}
# rename <file> <from> <to>: sed on a file, the portable way (BSD sed has no -i without a suffix).
rename() { sed "s|$2|$3|g" "$1" >"$work/rename.tmp" && cat "$work/rename.tmp" >"$1"; }

echo "Svelte Native: new app in $dir"
echo "  node $have_node, pnpm $have_pnpm, library $library_spec"
if [ "${#warnings[@]}" -gt 0 ]; then
  for warning in "${warnings[@]}"; do printf 'warning: %s\n' "$warning" >&2; done
fi
if [ -n "$ssh_note" ]; then printf 'note: %s\n' "$ssh_note"; fi

begin "creating the app from examples/minimal"
mkdir -p "$dir"
created=1
( sn_template_copy "$template" "$dir" "$work/patched-dependencies.yaml" )
# Named after the directory: the package, the Expo slug and scheme, the app's name and its Android/iOS identifiers.
base=$(basename "$dir")
slug=$(printf '%s' "$base" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]\{1,\}/-/g; s/^-//; s/-$//')
[ -n "$slug" ] || slug=app
case $slug in [a-z]*) ;; *) slug=app-$slug ;; esac
id=$(printf '%s' "$slug" | tr -d '-')
title=$slug
case $base in *[!A-Za-z0-9\ ._-]*) ;; *) title=$base ;; esac
rename "$dir/package.json" '"name": "svelte-native-minimal"' "\"name\": \"$slug\""
rename "$dir/app.json" 'Svelte Native Minimal' "$title"
rename "$dir/app.json" 'dev\.example\.sveltenativeminimal' "dev.example.$id"
rename "$dir/app.json" 'svelte-native-minimal' "$slug"
echo "named: $title ($slug, dev.example.$id)"
if [ "$use_local" = 1 ]; then cp "$svelte_tgz" "$dir/"; fi
finish

begin "installing @example/svelte-native and Svelte (pnpm add)"
( sn_install "$dir" "$library_spec" "$svelte_arg" )
finish

begin "copying and declaring the library's patches (pnpm install)"
( sn_patches_apply "$dir" "$work/patched-dependencies.yaml" )
finish

begin "checking the app (svelte-native doctor)"
( cd "$dir" && cap pnpm exec svelte-native doctor )
finish

finished=1
version=$(node -p 'require(process.argv[1]).version' "$dir/node_modules/@example/svelte-native/package.json")
commit=$(sed -n 's/.*resolution: {commit: \([0-9a-f]\{7,40\}\).*/\1/p' "$dir/pnpm-lock.yaml" | head -n 1)
echo
case $ref in *[!0-9a-f]*) from="$ref, commit ${commit:0:9}" ;; *) from="commit ${ref:0:9}" ;; esac
echo "Done in $((SECONDS - started)) s. $dir is a Svelte Native app on @example/svelte-native $version ($from)."
printf '%s' "$timings"
cat <<EOF

Next:

  cd "$dir"
  pnpm android        # or: pnpm ios (macOS, Xcode)

The first run builds the native app, which takes several minutes: it needs the Android SDK (Android Studio, with JDK 17 and ANDROID_HOME set)
and a device with USB debugging or an emulator, or Xcode and a simulator or a device on a Mac. This is a development build: Expo Go cannot load
the library's native modules. After the first install, \`pnpm dev\` starts the dev server again without rebuilding, and a save reloads the app.

${ssh_note:+Note: $ssh_note

}Something wrong: \`pnpm exec svelte-native doctor\` in the app says what, and a bug is an issue on
https://github.com/AlfayezDev/svelte-native/issues (the template asks for what is needed). Reference: packages/svelte-native/README.md.
EOF

#!/usr/bin/env bash
# Prints the CHANGELOG section of one version of @example/svelte-native: the notes of its GitHub Release (.github/workflows/release.yml).
#
#   scripts/release-notes.sh <version> [changelog]      (default: packages/svelte-native/CHANGELOG.md)
#
# The section is what follows the heading `## <version>` (or `## [<version>]`, with anything after it, such as ` - 2026-11-10`) up to the
# next `## ` heading. Exit status 1, with nothing on stdout, when the heading is missing or the section is empty. A warning on stderr when
# `## Unreleased` still holds entries: they belong under the version being released.
set -euo pipefail

version=${1:-}
[ -n "$version" ] || { echo "usage: scripts/release-notes.sh <version> [changelog]" >&2; exit 2; }
changelog=${2:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)/packages/svelte-native/CHANGELOG.md}
[ -f "$changelog" ] || { echo "release-notes: $changelog does not exist" >&2; exit 2; }

# section <heading-word>: the lines under the first `## ` heading whose first word is the argument, without surrounding blank lines.
section() {
  awk -v want="$1" '
    /^## / {
      if (found) exit
      heading = substr($0, 4)
      split(heading, words, " ")
      word = words[1]
      gsub(/^\[|\]$/, "", word)
      if (word == want) { found = 1; next }
    }
    found { lines[++count] = $0 }
    END {
      first = 1
      while (first <= count && lines[first] ~ /^[[:space:]]*$/) first++
      while (count >= first && lines[count] ~ /^[[:space:]]*$/) count--
      for (i = first; i <= count; i++) print lines[i]
    }
  ' "$changelog"
}

notes=$(section "$version")
if [ -z "$notes" ]; then
  echo "release-notes: $changelog has no '## $version' section, or it is empty" >&2
  exit 1
fi
if [ -n "$(section Unreleased)" ]; then
  echo "release-notes: warning: '## Unreleased' still holds entries; the release notes of $version do not include them" >&2
fi
printf '%s\n' "$notes"

#!/usr/bin/env bash
#
# Bump the app version.
#
#   ./bump-version.sh                 1.0.0-beta.11 -> 1.0.0-beta.12
#   ./bump-version.sh patch           -> 1.0.0        (releases the prerelease)
#   ./bump-version.sh minor           -> 1.1.0
#   ./bump-version.sh 2.0.0-rc.1      an explicit version
#   ./bump-version.sh prerelease --tag --changelog
#
# frontend/package.json is the single source of truth: the footer reads it
# through Vite's define, the backend reads the same file for its User-Agent,
# and build-image.sh takes the image tag from it. Bumping it is therefore the
# whole job — there is no second place to keep in step.
#
# It leaves the commit to you. `npm version` would make one itself, which is
# wrong here: the bump usually belongs *in* a release commit rather than in one
# of its own.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PART="prerelease"
PREID="beta"
TAG=false
CHANGELOG=false
DRY_RUN=false

usage() {
  cat <<'EOF'
Bump the version in frontend/package.json (and its lockfile).

Usage: ./bump-version.sh [part|version] [options]

  part        major | minor | patch | premajor | preminor | prepatch |
              prerelease (default), or an explicit version like 1.2.0

  --preid ID  Prerelease identifier (default: beta)
  --tag       Create an annotated git tag vX.Y.Z
  --changelog Insert a dated heading at the top of CHANGELOG.md
  --dry-run   Show what would change and stop
  -h, --help  This

Note: from a prerelease, `patch`, `minor` and `major` all resolve to the
release version (1.0.0-beta.11 -> 1.0.0). That is semver, not a bug — use
`prerelease` to stay on the beta line.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --preid)     PREID="${2:?--preid needs a value}"; shift 2 ;;
    --tag)       TAG=true; shift ;;
    --changelog) CHANGELOG=true; shift ;;
    --dry-run)   DRY_RUN=true; shift ;;
    -h|--help)   usage; exit 0 ;;
    -*)          echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
    *)           PART="$1"; shift ;;
  esac
done

PKG="frontend/package.json"
[[ -f "$PKG" ]] || { echo "cannot find $PKG — run this from the repo" >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is required to bump the version" >&2; exit 1; }

CURRENT="$(node -p "require('./$PKG').version")"

# --no-git-tag-version: npm would otherwise commit and tag on our behalf.
# Computed in a subshell against copies so --dry-run cannot leave the tree
# half-bumped if npm rejects the argument.
NEW="$(cd frontend && npm version "$PART" --preid="$PREID" \
        --no-git-tag-version --no-workspaces-update 2>/dev/null | tail -1 | sed 's/^v//')" || {
  echo "npm could not apply '$PART' to $CURRENT" >&2
  exit 1
}

if $DRY_RUN; then
  # Put it back: the bump has already been written by the call above.
  (cd frontend && npm version "$CURRENT" --preid="$PREID" --no-git-tag-version --allow-same-version >/dev/null 2>&1)
  echo "would bump  $CURRENT -> $NEW"
  echo "  files:    frontend/package.json, frontend/package-lock.json"
  $TAG       && echo "  tag:      v$NEW"
  $CHANGELOG && echo "  changelog: new heading at the top of CHANGELOG.md"
  exit 0
fi

echo "$CURRENT -> $NEW"
echo "  frontend/package.json"
echo "  frontend/package-lock.json"

if $CHANGELOG && [[ -f CHANGELOG.md ]]; then
  DATE="$(date '+%-d %B %Y')"
  # Inserted above the newest existing release so the file stays newest-first,
  # falling back to just after the title when there are no releases yet. The
  # `### ` heading is not decoration: the in-app changelog modal only renders
  # bullets that sit inside a section, so a bare list here would parse away to
  # a release with nothing under it. Left empty on purpose — a generated
  # summary of a release is worse than an obvious blank waiting to be filled.
  python3 - "$NEW" "$DATE" <<'PY'
import pathlib, sys
version, date = sys.argv[1], sys.argv[2]
p = pathlib.Path("CHANGELOG.md")
lines = p.read_text().split("\n")
block = [f"## v{version} — {date}", "", "### Changes", "", "- ", ""]
at = next((i for i, l in enumerate(lines) if l.startswith("## ")), None)
if at is None:
    at = next((i for i, l in enumerate(lines) if l.startswith("# ")), -1) + 1
    block = [""] + block
p.write_text("\n".join(lines[:at] + block + lines[at:]))
PY
  echo "  CHANGELOG.md (heading added — fill it in)"
fi

if $TAG; then
  if git rev-parse "v$NEW" >/dev/null 2>&1; then
    echo "  tag v$NEW already exists — leaving it alone" >&2
  else
    git tag -a "v$NEW" -m "v$NEW"
    echo "  tagged v$NEW"
  fi
fi

echo
echo "Next:"
echo "  review    git diff"
echo "  commit    git commit -am \"chore: bump version to $NEW\""
echo "  image     ./build-image.sh --push        # tags $NEW automatically"

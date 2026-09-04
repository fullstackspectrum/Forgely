#!/usr/bin/env bash
#
# Build the Forgely container image, tagged with the app's own version.
#
#   ./build-image.sh                          build locally, load into Docker
#   ./build-image.sh --push                   build multi-arch and push
#   ./build-image.sh -r ghcr.io/acme --push   push somewhere other than the default
#
# The version is read from frontend/package.json rather than passed in, so the
# tag cannot drift from the version the running app reports in its own footer.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
IMAGE_NAME="${FORGELY_IMAGE:-forgely}"
REGISTRY="${FORGELY_REGISTRY:-}"
PUSH=false
TAG_LATEST=true
EXTRA_TAGS=()
PLATFORMS=""

# Only when pushing. A single-arch image built on an Apple Silicon machine is
# an arm64 image, and most people pulling it are not on one.
DEFAULT_PUSH_PLATFORMS="linux/amd64,linux/arm64"

usage() {
  cat <<'EOF'
Build the Forgely image, tagged from frontend/package.json.

Usage: ./build-image.sh [options]

  --push                 Push to the registry instead of loading locally.
                         Builds for linux/amd64 and linux/arm64 by default.
  -r, --registry HOST    Registry and namespace, e.g. ghcr.io/acme.
                         Also settable as FORGELY_REGISTRY.
  -n, --name NAME        Image name (default: forgely, or FORGELY_IMAGE).
  -t, --tag TAG          Extra tag. Repeatable.
      --platform LIST    Override platforms, e.g. linux/amd64.
      --no-latest        Do not also tag :latest.
      --dry-run          Print the docker command and exit.
  -h, --help             This.

Examples
  ./build-image.sh
  ./build-image.sh --push -r ghcr.io/acme
  ./build-image.sh --platform linux/amd64 --no-latest
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --push)        PUSH=true; shift ;;
    -r|--registry) REGISTRY="${2:?--registry needs a value}"; shift 2 ;;
    -n|--name)     IMAGE_NAME="${2:?--name needs a value}"; shift 2 ;;
    -t|--tag)      EXTRA_TAGS+=("${2:?--tag needs a value}"); shift 2 ;;
    --platform)    PLATFORMS="${2:?--platform needs a value}"; shift 2 ;;
    --no-latest)   TAG_LATEST=false; shift ;;
    --dry-run)     DRY_RUN=true; shift ;;
    -h|--help)     usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done
DRY_RUN="${DRY_RUN:-false}"

# ---------------------------------------------------------------------------
# Version, from the one place that already tracks it
# ---------------------------------------------------------------------------
PKG="frontend/package.json"
[[ -f "$PKG" ]] || { echo "cannot find $PKG — run this from the repo" >&2; exit 1; }

# Node if it is here, otherwise a plain grep. The script should not require a
# toolchain just to read one field.
if command -v node >/dev/null 2>&1; then
  VERSION="$(node -p "require('./$PKG').version")"
else
  VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$PKG" | head -1)"
fi
[[ -n "$VERSION" ]] || { echo "could not read version from $PKG" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Provenance for the annotations
# ---------------------------------------------------------------------------
REVISION="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
# --porcelain rather than diff-index: it catches untracked files too, which do
# end up in the build context. Files matched by .gitignore are excluded, so a
# scan report or a local cache does not mark every build dirty.
if [[ "$REVISION" != unknown && -n "$(git status --porcelain 2>/dev/null)" ]]; then
  # Marked rather than refused: building an image from a dirty tree is a normal
  # thing to do while iterating. It just must not claim to be that commit.
  REVISION="${REVISION}-dirty"
  echo "note: working tree is dirty; revision annotated as ${REVISION}"
fi
SOURCE_URL="$(git remote get-url origin 2>/dev/null || echo '')"
SOURCE_URL="${SOURCE_URL%.git}"
CREATED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ---------------------------------------------------------------------------
# Tags
# ---------------------------------------------------------------------------
PREFIX="$IMAGE_NAME"
[[ -n "$REGISTRY" ]] && PREFIX="${REGISTRY%/}/$IMAGE_NAME"

TAG_ARGS=(-t "${PREFIX}:${VERSION}")
$TAG_LATEST && TAG_ARGS+=(-t "${PREFIX}:latest")
for t in ${EXTRA_TAGS+"${EXTRA_TAGS[@]}"}; do TAG_ARGS+=(-t "${PREFIX}:${t}"); done

# ---------------------------------------------------------------------------
# OCI annotations
#
# Applied at both levels on purpose. `manifest:` lands on each per-platform
# image; `index:` lands on the multi-arch index, which is what a registry UI
# and most tooling actually reads. Annotating only one leaves the other blank.
# ---------------------------------------------------------------------------
declare -a ANNOTATIONS=(
  "org.opencontainers.image.title=Forgely"
  "org.opencontainers.image.description=Security graph visualisation for Cloudsmith artifact repositories — SCA and CIEM"
  "org.opencontainers.image.version=${VERSION}"
  "org.opencontainers.image.revision=${REVISION}"
  "org.opencontainers.image.created=${CREATED}"
  "org.opencontainers.image.licenses=Apache-2.0"
  "org.opencontainers.image.vendor=Forgely"
  # Set explicitly, or the base image's own authors label survives and the
  # image claims to have been written by the Chainguard team.
  "org.opencontainers.image.authors=Forgely"
  "org.opencontainers.image.base.name=cgr.dev/chainguard/python:latest"
)
[[ -n "$SOURCE_URL" ]] && ANNOTATIONS+=(
  "org.opencontainers.image.source=${SOURCE_URL}"
  "org.opencontainers.image.url=${SOURCE_URL}"
  "org.opencontainers.image.documentation=${SOURCE_URL}#readme"
)

ANNOTATION_ARGS=()
for a in "${ANNOTATIONS[@]}"; do
  ANNOTATION_ARGS+=(--annotation "manifest:${a}")
  # An index only exists for a multi-platform build; harmless otherwise.
  $PUSH && ANNOTATION_ARGS+=(--annotation "index:${a}")
done

# Labels as well as annotations. `docker inspect` reads labels, not
# annotations, so without these the metadata is invisible to the most common
# way of looking for it.
LABEL_ARGS=()
for a in "${ANNOTATIONS[@]}"; do LABEL_ARGS+=(--label "$a"); done

# ---------------------------------------------------------------------------
# Output mode
# ---------------------------------------------------------------------------
if $PUSH; then
  [[ -n "$REGISTRY" ]] || {
    echo "--push needs a registry: pass -r HOST/NAMESPACE or set FORGELY_REGISTRY" >&2
    exit 2
  }
  OUTPUT_ARGS=(--push)
  PLATFORMS="${PLATFORMS:-$DEFAULT_PUSH_PLATFORMS}"
else
  # --load cannot take a multi-platform image: the daemon holds one per tag.
  OUTPUT_ARGS=(--load)
  if [[ -n "$PLATFORMS" && "$PLATFORMS" == *,* ]]; then
    echo "--load cannot take multiple platforms; use --push or one --platform" >&2
    exit 2
  fi
fi

PLATFORM_ARGS=()
[[ -n "$PLATFORMS" ]] && PLATFORM_ARGS=(--platform "$PLATFORMS")

# `${a[@]+"${a[@]}"}` rather than `"${a[@]}"`: under `set -u` an empty array is
# an unbound variable on bash 3.2, which is the bash macOS ships.
CMD=(docker buildx build
  "${TAG_ARGS[@]}"
  ${PLATFORM_ARGS[@]+"${PLATFORM_ARGS[@]}"}
  "${ANNOTATION_ARGS[@]}"
  "${LABEL_ARGS[@]}"
  "${OUTPUT_ARGS[@]}"
  .)

echo "Forgely ${VERSION}"
echo "  tags:      ${PREFIX}:${VERSION}$($TAG_LATEST && echo ", ${PREFIX}:latest")"
echo "  revision:  ${REVISION}"
echo "  platforms: ${PLATFORMS:-host}"
echo "  output:    $($PUSH && echo push || echo "load into local Docker")"
echo

if $DRY_RUN; then
  printf '%q ' "${CMD[@]}"; echo
  exit 0
fi

"${CMD[@]}"

echo
echo "Done: ${PREFIX}:${VERSION}"
$PUSH || echo "Run it:  docker run --rm -p 8000:8000 -v forgely-cache:/data ${PREFIX}:${VERSION}"

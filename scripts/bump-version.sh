#!/bin/bash
# Usage: ./scripts/bump-version.sh [patch|minor|major]
# Updates BUILD_TIME and optionally bumps the version number in engine/version.js

VFILE="docs/engine/version.js"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Update BUILD_TIME
sed -i "s|const BUILD_TIME = '.*';|const BUILD_TIME = '${NOW}';|" "$VFILE"

# Optional version bump
BUMP="${1:-patch}"
CURRENT=$(grep "const VERSION" "$VFILE" | grep -o "'[^']*'" | tr -d "'")
IFS='.' read -r MA MI PA <<< "$CURRENT"
case "$BUMP" in
  major) MA=$((MA+1)); MI=0; PA=0 ;;
  minor) MI=$((MI+1)); PA=0 ;;
  patch) PA=$((PA+1)) ;;
esac
NEW_VER="${MA}.${MI}.${PA}"
sed -i "s|const VERSION = '.*';|const VERSION = '${NEW_VER}';|" "$VFILE"

echo "Version: ${CURRENT} → ${NEW_VER}  |  BUILD_TIME: ${NOW}"

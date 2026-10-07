#!/usr/bin/env bash
# Package each skill as an uploadable zip (SKILL.md at the zip root plus any
# supporting files such as references/). Upload in Copilot Studio:
#   Build tab → Skills → Add skill → Upload a skill
#
# Usage: copilot-studio/scripts/package-skills.sh [outDir]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_DIR="$HERE/../skills"
OUT_DIR="$(mkdir -p "${1:-$HERE/../dist}" && cd "${1:-$HERE/../dist}" && pwd)"

node "$HERE/validate-skills.js" "$SKILLS_DIR"

rm -f "$OUT_DIR"/*.zip
for dir in "$SKILLS_DIR"/*/; do
  name="$(basename "$dir")"
  (cd "$dir" && zip -qr -X "$OUT_DIR/$name.zip" . -x '.*')
  echo "packaged $OUT_DIR/$name.zip"
done

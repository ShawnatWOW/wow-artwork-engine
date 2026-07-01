#!/usr/bin/env bash
# Export ONLY the WOW Artwork Engine files into a fresh, clean git repo and push
# them to a new remote — leaving the unrelated luxury-lease-scan files behind.
#
# Usage:
#   infra/scripts/export-to-new-repo.sh git@github.com:ShawnatWOW/wow-artwork-engine.git
#
# Run from the root of the luxury-lease-scan checkout. Creates a temp working
# copy; does not modify this repo.
set -euo pipefail

REMOTE="${1:?Usage: export-to-new-repo.sh <new-repo-remote-url>}"
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="$(mktemp -d)"

# Engine paths to carry over (everything else — the lease scanner — is dropped).
PATHS=(
  server
  web
  migrations
  scripts/spikes
  infra/pm2
  infra/terraform
  infra/scripts
  .env.example
  .gitignore
  WOW_Artwork_Engine_Build_Plan.md
  .github/workflows/wow-artwork-engine-ci.yml
  .github/workflows/wow-artwork-engine-deploy.yml
)

echo "Copying engine files → $DEST"
for p in "${PATHS[@]}"; do
  if [ -e "$SRC/$p" ]; then
    mkdir -p "$DEST/$(dirname "$p")"
    cp -R "$SRC/$p" "$DEST/$p"
  fi
done

# Root README for the new repo (engine-specific, not the lease-scan one).
cp "$SRC/infra/new-repo/README.md" "$DEST/README.md"

cd "$DEST"
# Drop any installed deps / build output that may have been copied.
rm -rf server/node_modules web/node_modules web/dist server/dist scripts/spikes/out

git init -q -b main
git add -A
git commit -q -m "Initial import: WOW Artwork Engine (M0 foundations + spikes + locked decisions)"
git remote add origin "$REMOTE"

echo
echo "Ready in $DEST. Pushing to $REMOTE …"
git push -u origin main

echo
echo "Done. New repo populated from $DEST"

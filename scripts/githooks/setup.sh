#!/bin/bash
# Enable hooks for this repo.
# Run from the repo root: bash scripts/githooks/setup.sh
git config core.hooksPath scripts/githooks
echo "Git hooks enabled: scripts/githooks"
echo "  - pre-commit:   replaces rpcable symlink with real files before commit"
echo "  - post-commit:  restores rpcable symlink after commit"
echo "  - post-checkout:restores rpcable symlink after checkout/abort"

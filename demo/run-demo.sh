#!/usr/bin/env bash
# Runs the whole Smoke Alarm demo on NEAR testnet in one go (Mac and Linux).
# Usage, from the smoke-alarm folder:   bash demo/run-demo.sh YOUR-NAME.testnet
# Needs: the NEAR tool installed, and a testnet account you created yourself (see DEMO.md).
set -euo pipefail
ACCOUNT="${1:?Usage: bash demo/run-demo.sh YOUR-NAME.testnet}"

echo; echo "=== Starting fresh: forgetting earlier testnet snapshots ==="
rm -rf data-testnet

echo; echo "=== Step 1 of 4: deploying the HONEST token (v1) to $ACCOUNT ==="
near contract deploy "$ACCOUNT" use-file demo/token-v1.wasm without-init-call network-config testnet sign-with-keychain send
sleep 5
near contract call-function as-read-only "$ACCOUNT" version json-args {} network-config testnet now

echo; echo "=== Step 2 of 4: Smoke Alarm takes its first snapshot ==="
node src/scan.js --network testnet "$ACCOUNT"

echo; echo "=== Step 3 of 4: now playing the bad guy, swapping in v2 ==="
read -r -p "Press Enter to swap the code..."
near contract deploy "$ACCOUNT" use-file demo/token-v2.wasm without-init-call network-config testnet sign-with-keychain send
sleep 5

echo; echo "=== Step 4 of 4: Smoke Alarm checks again ==="
node src/scan.js --network testnet "$ACCOUNT"

echo; echo "=== Proof the rules changed: ==="
near contract call-function as-read-only "$ACCOUNT" version json-args {} network-config testnet now
echo; echo "Done. Look for [CRITICAL] in Step 4 above."

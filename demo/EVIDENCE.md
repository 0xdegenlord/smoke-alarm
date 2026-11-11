# Demo evidence (NEAR testnet)

Account: `smoke-demo-degen.testnet` (created via the testnet faucet, master key held by the builder on purpose)

Run 1, 2026-11-09 01:19 Asia/Dhaka:
- Deploy v1 (honest): `4WecMXec1jYrv1vdJHhLAafBDbWbUiVZXbGBbK3kNAT9`
- Deploy v2 (swapped): `EwSqyzRYHfu6ERWFfhE6rJz6hkvk18DKoBg5XXH2pPpB`
- Smoke Alarm result: `[CRITICAL] UNILATERAL_RECOMPILE`, printed to terminal (Telegram not yet configured)

Run 2, 2026-11-09 01:35 Asia/Dhaka:
- Deploy v1 (honest): `8jpnKibMxeQeCzb2wztYc6nXRW2jfgaQM4cL4xaEx6ad`
- Smoke Alarm result: `CRITICAL: UNILATERAL_RECOMPILE` delivered to Telegram at 2026-11-08T19:35:34.980Z

Explorer: https://testnet.nearblocks.io/address/smoke-demo-degen.testnet

Code fingerprints (NEAR code_hash = base58 of sha256 of the .wasm file):
- `demo/token-v1.wasm`: `GNZrMCbwtSyufBp6BB6PLeH3qirQEMBajZFpCnpcHVQu` (shown by near-cli when v1 was deployed)
- `demo/token-v2.wasm`: `44AuFhjub3yegiuiVJq972jDXeEnpoN71KVKFEerd69w` (recorded on chain at testnet block 276822427)

`test/replay.test.js` checks both against the files in this repo with no network.

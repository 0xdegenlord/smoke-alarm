# Smoke Alarm

Smoke Alarm watches NEAR fungible tokens and alerts you when someone can change, or just changed, the code behind a token.

On NEAR, a token is an account that holds code. Whoever holds a full-access key ("master key") to that account can deploy new code to it at any time. Balances stay, but the rules change. One-time safety checks miss this, because a token that was safe yesterday can be recompiled today. Smoke Alarm takes repeated snapshots of each token and reports what changed, sorted by how much it matters.

Built for the NEAR HACKATHON (November 2026).

## Try it in Telegram (no setup)

Open [@near_smoke_alarm_bot](https://t.me/near_smoke_alarm_bot) and send:

```
/watch smoke-demo-degen.testnet
```

The bot replies right away with the token's status (who holds a master key, and its code fingerprint) and starts watching it for you. `smoke-demo-degen.testnet` is our demo token, whose code we swap on purpose, so you see a real alert. Use any NEAR token instead, for example `/watch blackdragon.tkn.near`.

| Command | What it does |
|---|---|
| `/watch <token>` | Alerts you when the token's code or master keys change |
| `/check <token>` | One-time check, no alerts |
| `/list` | The tokens you watch |
| `/stop <token>` | Stops alerts for a token |

Each person gets alerts only for the tokens they watch. The bot runs on Cloudflare Workers (free plan), checks watched tokens every minute, and keeps subscriptions in private Workers KV storage, so nobody's chat ID is public. The code is one file, [`bot/worker.js`](bot/worker.js), using the same rules as the scanner. See [Running the bot yourself](#running-the-bot-yourself).

## Quick start (no keys, no wallet, no account)

Needs Node.js 22 or newer and an internet connection. There are no dependencies to install.

1. Run the tests.
   ```
   npm test
   ```
   You see every test pass (`fail 0`). This step works offline. Three of the tests (`test/replay.test.js`) replay real NEAR responses recorded on 9 November 2026 and prove, with no network:
   - wNEAR and SWEAT are read correctly and both have zero master keys.
   - The testnet demo account's on-chain code fingerprint is exactly the fingerprint of `demo/token-v2.wasm` in this repo.
   - Swapping that account from v1 to v2 fires `UNILATERAL_RECOMPILE`.

2. Scan the real tokens in `watchlist.json` on NEAR mainnet.
   ```
   npm run scan
   ```
   You see one line per token showing its symbol, account and `0 master key(s)` (for example `wNEAR` and `wrap.near`), and a final line ending in `0 alert(s), 12 new baseline(s), 0 could not be checked.` The first scan only records a baseline. It takes about 10 seconds. If there is no internet, every token reports `could not be checked`, the command prints `Every token failed to scan` and exits with code 1.

3. Scan again.
   ```
   npm run scan
   ```
   You see a final line ending in `0 alert(s), 0 new baseline(s), 0 could not be checked.` Nothing changed, so nothing is reported.

4. Build the status page.
   ```
   npm run page
   ```
   You see `Wrote docs/index.html with 12 token(s).` Open `docs/index.html` in a browser. You see each token marked `Locked`, with its code fingerprint and the time it was checked.

5. Watch a token get swapped, on testnet. Follow [DEMO.md](DEMO.md). You deploy a small token, keep its master key, swap its code, and see:
   ```
   [CRITICAL] DEMO (YOUR-NAME.testnet): the token's code changed while someone held a master key. One person could have rewritten the rules.
   ```
   This step needs the NEAR command line tool and a free testnet account. If you only want to verify it happened, the transactions from our own run are listed under [Evidence](#evidence).

Optional: set up Telegram (below) and the same alerts arrive on your phone.

## What it reports

Each scan compares the new snapshot of a token with the previous one.

| Event | Severity | Meaning |
|---|---|---|
| `UNILATERAL_RECOMPILE` | critical | The code changed while someone held a master key. One person could have rewritten the rules. |
| `NEW_FULL_ACCESS_KEY` | critical | A new master key appeared, so someone can now replace the code. Caught even if a key was swapped and the count stayed the same. |
| `CONTRACT_REMOVED` | critical | The token's code was removed. |
| `ACCOUNT_DELETED` | critical | The token's account no longer exists. |
| `CONCENTRATION_UP` | warn | The top 10 holders' share of supply rose by 10 or more percentage points. |
| `KEYS_REMOVED` | good | All master keys were removed. The token is now locked. |
| `UPGRADE_NO_KEYS` | warn | The code changed with no master key present, so the contract replaced its own code through one of its methods. That can be community governance or a single owner account; Smoke Alarm does not check which. |
| `ACCOUNT_CREATED` | critical or warn | A token account that had disappeared exists again. Critical if it now has master keys, otherwise a warning to treat it as a new token. |
| `BASELINE` | info | First snapshot of a token. Recorded, not alerted. |

Critical, warn and good events are alerted. Info events are only written to the log. The same change never alerts twice, and an alert is never lost: alerts are sent before the new snapshot is saved, so if sending fails, the next scan sends it again.

## How it relates to launchpads that lock their own coins

Some launchpads, such as OATH in this hackathon, verify the coins they create at launch. Smoke Alarm checks any existing NEP-141 token, including tokens launched before such launchpads existed, and keeps checking after launch. The two are complementary.

## Why this needs NEAR

On Solana, mint and freeze authority are fields on the token. Once revoked, the token is structurally frozen, so a one-time check works. On NEAR, a token is an account with replaceable code and mutable keys, so "safe" is only true at a point in time. That is the specific risk Smoke Alarm watches, and the signals it reads exist because NEAR exposes them:

| NEAR feature | Used for | Where in the code |
|---|---|---|
| `view_account` RPC, `code_hash` | Detecting that the code changed | `src/rpc.js`, `src/snapshot.js` |
| `view_access_key_list` RPC, `FullAccess` permission | Detecting who can replace the code | `src/rpc.js`, `src/snapshot.js` |
| NEP-141 view methods `ft_metadata`, `ft_total_supply` | Token name and supply | `src/snapshot.js` |
| Contract deployment on testnet (`near contract deploy`) | The live demo | `DEMO.md`, `demo/` |

Holder concentration comes from the FastNEAR holders API (`https://api.fastnear.com/v1/ft/{token}/top`).

## Telegram alerts (optional)

Without this, alerts print in the terminal.

1. In Telegram, message `@BotFather`, send `/newbot`, and follow the steps. You get a bot token.
2. Copy `.env.example` to `.env` and put the token after `TELEGRAM_BOT_TOKEN=`. `.env` is ignored by git.
3. Open your new bot in Telegram, tap Start, and send it any message.
4. Run `npm run telegram:chat-id`. You see `Connected to your bot @...` and a line like `TELEGRAM_CHAT_ID=123456789`. Put that number in `.env`.
5. Run `npm run scan`. Any alert now arrives in Telegram.

## Running on a schedule

`.github/workflows/scan.yml` runs the tests, the mainnet scan, a testnet scan of the demo token and two locked tokens (below) and the page build every 5 minutes in GitHub Actions, so nothing has to stay on at home. Five minutes is the fastest GitHub allows, and GitHub sometimes starts scheduled runs late when it is busy.

1. Push this repository to GitHub.
2. Add two repository secrets, `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (Settings, Secrets and variables, Actions).
3. To publish the status page, set Settings, Pages, to deploy from the `main` branch, `/docs` folder.

The workflow commits `data/`, `data-testnet/` and `docs/` back to the repository only when a new event is recorded, so the history shows every change that was ever seen.

## Running the bot yourself

1. In the Cloudflare dashboard, create a KV namespace.
2. Create a Worker, paste in `bot/worker.js`, and deploy.
3. In the Worker's settings, bind the KV namespace as `DB`, add a Cron Trigger that runs every minute, and add a secret `BOT_TOKEN` with your bot token from @BotFather.
4. Open `https://<your-worker>.workers.dev/setup` once. You see `Connected. Open https://t.me/<your bot> and send /start.`

The free plan allows 50 outgoing requests per run, so each run checks up to 15 tokens. With more tokens, the bot rotates through them, one slice per minute. Holder concentration is not checked by the bot; the GitHub scanner does that.

Once a bot is connected this way, Telegram sends its messages to the Worker, so `npm run telegram:chat-id` no longer sees them. Find your chat ID before step 4, or use a separate bot for the GitHub scanner.

## Commands

| Command | What it does |
|---|---|
| `npm test` | Runs all tests offline against a simulated NEAR network |
| `npm run scan` | Scans every token in `watchlist.json` on mainnet once |
| `npm run scan -- wrap.near token.sweat` | Scans only the tokens you name |
| `npm run scan -- --network testnet NAME.testnet` | Scans a testnet account |
| `npm run scan -- --every 10 ...` | Keeps scanning every 10 seconds (minimum 5) |
| `npm run page` | Writes `docs/index.html` from the saved snapshots |
| `npm run telegram:chat-id` | Prints the Telegram chat ID for your bot |
| `npm run scan -- --help` | Shows the scan options |

Snapshots are saved in `data/` (mainnet) and `data-testnet/` (testnet). Events are appended to `events.jsonl` in the same folder.

## The live demo token

`smoke-demo-degen.testnet` is a small token kept on testnet on purpose with its master key still in place, so its code can be swapped at any time. It is in the 5-minute watch, so every swap fires a public `UNILATERAL_RECOMPILE` alert. It runs `demo/token-v2.wasm` today; the replay tests check that offline.

Next to it, the watch includes two tokens with no keys at all, `ember-daily-degen.testnet` and `ember-fast-degen.testnet`. Their code can never change, so they should stay quiet forever. On the status page the demo token shows red ("1 master key held") and those two show green ("Locked").

Check all three yourself:

```
npm run scan -- --network testnet smoke-demo-degen.testnet ember-daily-degen.testnet ember-fast-degen.testnet
```

You see the demo token as `DEMO` with `1 master key(s)`, and the other two as `EMBER` with `0 master key(s)`.

To see the alarm fire on a token you control, follow [DEMO.md](DEMO.md) with your own free testnet account.

## What we found on real data

Checked live on 9 November 2026:

- All 12 tokens in `watchlist.json` (including wNEAR, SWEAT, USDt, REF, the bridged USDC.e, USDT.e and DAI, and the memecoins BLACKDRAGON, SHITZU and LONK) had zero master keys. They are locked, which is the safe state. Smoke Alarm correctly stays quiet on them.
- The top 10 holders' share looks very high for large tokens (wNEAR 98.48%) because the largest holders are pools, bridges and contracts, not people. The concentration warning only fires on a jump of 10 or more points, not on a high level.
- The free RPC endpoint starts returning rate-limit errors (code -429) after roughly 80 quick requests. The scanner pauses between tokens and retries with backoff.

## Limits

- Smoke Alarm detects change, not intent. A locked token can still have harmful logic in code that never changes. No alerts is not a safety guarantee.
- Contracts with their own upgrade method can change code with no master key. These are reported as `UPGRADE_NO_KEYS` (warn). Smoke Alarm does not check who is allowed to call that method.
- Changes are seen at the next scan, so with the 5-minute schedule an alert usually arrives within 5 to 15 minutes of the change, depending on how busy GitHub is. For faster alerts, run `npm run scan -- --every 30` on an always-on machine.
- Holder data covers mainnet only and counts pools and contracts as holders.
- The demo token in `demo/` is a minimal hand-written stand-in for a token. It answers the read-only token methods a wallet asks (`ft_metadata`, `ft_total_supply`, `ft_balance_of`) plus `version`, and does not support transfers. Its only purpose is to show a code swap.

## Project layout

```
src/rpc.js               NEAR RPC client with fallback endpoints and rate-limit backoff
src/snapshot.js          Takes one snapshot of a token
src/classify.js          Compares two snapshots and names the change
src/store.js             Saves snapshots and the event log as JSON
src/scan.js              The scan command
src/notify.js            Telegram alerts, or terminal output if not configured
src/page.js              Builds the status page
src/telegram-chat-id.js  Finds your Telegram chat ID
src/env.js               Loads .env
bot/worker.js            The Telegram bot, on Cloudflare Workers
demo/                    Demo token source (.wat), compiled (.wasm), demo scripts, evidence
test/                    Tests: a simulated NEAR network, plus replays of real recorded responses
test/fixtures/           Real NEAR responses recorded on 9 November 2026
```

## Evidence

Demo run on NEAR testnet, account `smoke-demo-degen.testnet`, 9 November 2026. See [demo/EVIDENCE.md](demo/EVIDENCE.md).

- Deploy of the honest token (v1): `4WecMXec1jYrv1vdJHhLAafBDbWbUiVZXbGBbK3kNAT9`
- Deploy of the swapped token (v2): `EwSqyzRYHfu6ERWFfhE6rJz6hkvk18DKoBg5XXH2pPpB`
- Smoke Alarm reported `UNILATERAL_RECOMPILE` on the next scan, and on a second run delivered it to Telegram.
- The account's code fingerprint on testnet is `44AuFhjub3yegiuiVJq972jDXeEnpoN71KVKFEerd69w`, which is the sha256 (base58) of `demo/token-v2.wasm`. The v1 fingerprint is `GNZrMCbwtSyufBp6BB6PLeH3qirQEMBajZFpCnpcHVQu`. `npm test` checks both offline.

Account history: https://testnet.nearblocks.io/address/smoke-demo-degen.testnet

## Disclosures

- All code in this repository was written between 8 and 11 November 2026, after the hackathon's 19 October 2026 start. No pre-existing code was used.
- Written with AI assistance (Claude), as permitted by the hackathon rules.
- No runtime dependencies. Only Node.js built-ins are used.
- Outside tools: `near-cli-rs` 0.31.1 for the testnet demo only; `wabt` 1.0.36 to compile `demo/*.wat` into `demo/*.wasm` (not needed to run anything); FastNEAR RPC and API for chain data; the Telegram Bot API for alerts; GitHub Actions for scheduling; Cloudflare Workers and Workers KV for the Telegram bot.

## License

MIT. See [LICENSE](LICENSE).

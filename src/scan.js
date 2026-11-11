#!/usr/bin/env node
// Usage:
//   npm run scan                                   scan every token in watchlist.json once
//   npm run scan -- wrap.near token.sweat          scan only the tokens you name
//   npm run scan -- --network testnet my.testnet   scan a testnet account
//   npm run scan -- --every 10 ...                 keep scanning every 10 seconds (for the live demo)
import { readFile } from "node:fs/promises";
import { takeSnapshot } from "./snapshot.js";
import { classify, shouldAlert } from "./classify.js";
import { createStore } from "./store.js";
import { notify } from "./notify.js";
import { loadEnvFile } from "./env.js";
import { pathToFileURL } from "node:url";

export const NETWORKS = {
  mainnet: ["https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org"],
  testnet: ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"],
};
const PAUSE_BETWEEN_TOKENS_MS = 400;
const ICON = { critical: "[CRITICAL]", warn: "[WARN]", good: "[GOOD]", info: "[info]" };

// Scans every token, then hands the alerts to `deliver` BEFORE saving anything.
// If delivery fails, nothing is saved, so the next scan sees the same change and alerts again.
export async function runScan({
  tokens,
  network = "mainnet",
  dataDir,
  log = console.log,
  snapshotOpts = {},
  deliver = async () => {},
} = {}) {
  const store = createStore(dataDir ?? (network === "mainnet" ? "data" : `data-${network}`));
  const snapshots = await store.loadSnapshots();
  const allEvents = [];
  const failed = [];

  for (const [i, token] of [...new Set(tokens)].entries()) {
    if (i > 0 && !snapshotOpts.fetchImpl) await new Promise((r) => setTimeout(r, PAUSE_BETWEEN_TOKENS_MS));
    try {
      const snap = await takeSnapshot(token, {
        endpoints: NETWORKS[network],
        holders: network === "mainnet", // the holder service only covers mainnet
        ...snapshotOpts,
      });
      const events = classify(snapshots[token], snap);
      snapshots[token] = snap;
      allEvents.push(...events);
      const keys = snap.exists ? `${snap.fullAccessKeys.length} master key(s)` : "account missing";
      const share = snap.top10Share == null ? "" : `, top 10 hold ${snap.top10Share}%`;
      log(`${(snap.symbol ?? "").padEnd(12)} ${token.slice(0, 44).padEnd(45)} ${keys}${share}`);
      for (const e of events) if (e.type !== "BASELINE") log(`   ${ICON[e.severity]} ${e.message}`);
    } catch (e) {
      failed.push(token);
      log(`             ${token.slice(0, 44).padEnd(45)} could not be checked: ${e.message}`);
    }
  }

  const alerts = allEvents.filter(shouldAlert);
  await deliver(alerts);
  await store.saveSnapshots(snapshots);
  await store.appendEvents(allEvents);
  return { events: allEvents, alerts, failed };
}

const USAGE = `Usage: npm run scan -- [--network mainnet|testnet] [--every SECONDS] [token ...]
  With no tokens, scans every token in watchlist.json.
  --every keeps scanning, waiting SECONDS between scans (5 to 86400).`;

export function parseArgs(argv) {
  const args = [];
  let network = "mainnet";
  let every;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") return { help: true };
    const [flag, inline] = a.startsWith("--") ? a.split("=", 2) : [a, undefined];
    if (flag === "--network" || flag === "--every") {
      const value = inline ?? argv[++i];
      if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value.\n${USAGE}`);
      if (flag === "--network") network = value;
      else every = Number(value);
    } else if (a.startsWith("-")) {
      throw new Error(`Unknown option "${a}".\n${USAGE}`);
    } else {
      args.push(a);
    }
  }
  if (!NETWORKS[network]) throw new Error(`Unknown network "${network}". Use mainnet or testnet.`);
  if (every !== undefined && !(every >= 5 && every <= 86400)) throw new Error("--every needs a number of seconds, from 5 to 86400.");
  if (network !== "mainnet" && args.length === 0) throw new Error(`Name the ${network} account(s) to scan. The watchlist is mainnet only.`);
  return { network, every, tokens: args };
}

async function scanOnce(tokens, network) {
  const { events, alerts, failed } = await runScan({ tokens, network, deliver: (a) => notify(a, { network }) });
  const baselines = events.filter((e) => e.type === "BASELINE").length;
  console.log(`\n${new Date().toLocaleTimeString()}  ${alerts.length} alert(s), ${baselines} new baseline(s), ${failed.length} could not be checked.`);
  if (failed.length > 0 && failed.length === new Set(tokens).size) {
    throw new Error("Every token failed to scan. Check your internet connection.");
  }
}

async function main() {
  loadEnvFile();
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  const { network, every, tokens: named } = parsed;
  const tokens = named.length > 0 ? named : JSON.parse(await readFile("watchlist.json", "utf8")).tokens;
  const telegram = process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID ? "Telegram" : "this terminal";
  console.log(`Scanning ${tokens.length} token(s) on ${network}. Alerts go to ${telegram}.\n`);

  if (!every) return scanOnce(tokens, network);
  await scanOnce(tokens, network).catch((e) => console.error(`Scan failed, will retry: ${e.message}`));
  {
    console.log(`Watching. Checking again every ${every} seconds. Press Ctrl+C to stop.`);
    for (;;) {
      await new Promise((r) => setTimeout(r, every * 1000));
      await scanOnce(tokens, network).catch((e) => console.error(`Scan failed, will retry: ${e.message}`));
    }
  }
}

// Run main() only when started from the command line, on Windows, Mac and Linux alike.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

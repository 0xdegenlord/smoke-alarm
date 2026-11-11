// Replays real NEAR responses recorded on 9 November 2026, so the core claims can be
// checked with no network at all. See test/fixtures/recorded-2026-11-09.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScan } from "../src/scan.js";
import { createStore } from "../src/store.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/recorded-2026-11-09.json", import.meta.url), "utf8"));
const DEMO = "smoke-demo-degen.testnet";

// NEAR's code_hash is the base58 form of the sha256 of the exact .wasm file.
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(buf) {
  let n = BigInt("0x" + buf.toString("hex"));
  let s = "";
  while (n > 0n) {
    s = ALPHABET[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of buf) {
    if (b !== 0) break;
    s = "1" + s;
  }
  return s;
}
async function codeHashOf(file) {
  return base58(createHash("sha256").update(await readFile(new URL(`../demo/${file}`, import.meta.url))).digest());
}

// Answers exactly like the real endpoints did, using the recorded data.
// `override` lets a test swap one account's code hash to reconstruct an earlier state.
function recordedChain(override = {}) {
  const json = (body) => ({ ok: true, status: 200, json: async () => body });
  return async (url, init) => {
    if (url.includes("/v1/ft/")) {
      const token = url.split("/v1/ft/")[1].split("/")[0];
      return json(fixture.holders[token] ?? { token_id: token, accounts: [] });
    }
    const { id, params } = JSON.parse(init.body);
    const net = url.includes("test.") || url.includes("testnet") ? "testnet" : "mainnet";
    const hit = fixture.rpc.find(
      (e) => e.net === net && e.acct === params.account_id && e.type === params.request_type && (e.method ?? undefined) === (params.method_name ?? undefined),
    );
    if (!hit) return json({ jsonrpc: "2.0", id, error: { name: "HANDLER_ERROR", cause: { name: "NOT_IN_RECORDING" } } });
    if (params.request_type === "view_account") {
      const code_hash = override[params.account_id] ?? hit.r.code_hash;
      return json({ jsonrpc: "2.0", id, result: { code_hash, amount: hit.r.amount, block_height: hit.r.h } });
    }
    if (params.request_type === "view_access_key_list") {
      const keys = hit.r.keys.map((k) => ({ public_key: k.pk, access_key: { permission: k.perm === "FullAccess" ? "FullAccess" : { FunctionCall: {} } } }));
      return json({ jsonrpc: "2.0", id, result: { keys, block_height: hit.r.h } });
    }
    return json({ jsonrpc: "2.0", id, result: { result: [...Buffer.from(hit.r.text)], block_height: hit.r.h } });
  };
}

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "replay-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const quiet = () => {};

test("replay: real mainnet tokens wNEAR and SWEAT are read correctly and are locked", () =>
  withTempDir(async (dir) => {
    const { events, failed } = await runScan({
      tokens: ["wrap.near", "token.sweat"],
      dataDir: dir,
      log: quiet,
      snapshotOpts: { fetchImpl: recordedChain() },
    });
    assert.deepEqual(failed, []);
    assert.deepEqual(events.map((e) => e.type), ["BASELINE", "BASELINE"]);
    const s = await createStore(dir).loadSnapshots();
    assert.equal(s["wrap.near"].symbol, "wNEAR");
    assert.equal(s["wrap.near"].codeHash, "DL2f5xmZ44cQRP6vBMt94rvseH5d5KKnAGis2WkTAsh1");
    assert.deepEqual(s["wrap.near"].fullAccessKeys, [], "wrap.near had zero master keys");
    assert.equal(s["token.sweat"].symbol, "SWEAT");
    assert.deepEqual(s["token.sweat"].fullAccessKeys, [], "token.sweat had zero master keys");
    assert.equal(s["token.sweat"].top10Share, 79.22, "top 10 SWEAT holders computed from the real holder list");
  }));

test("replay: the live testnet demo account runs exactly the code in demo/token-v2.wasm", async () => {
  const onChain = fixture.rpc.find((e) => e.acct === DEMO && e.type === "view_account").r.code_hash;
  assert.equal(await codeHashOf("token-v2.wasm"), onChain);
  assert.equal(await codeHashOf("token-v1.wasm"), "GNZrMCbwtSyufBp6BB6PLeH3qirQEMBajZFpCnpcHVQu", "v1 hash, as shown when v1 was deployed");
});

test("replay: the v1 to v2 swap on the real demo account fires UNILATERAL_RECOMPILE", () =>
  withTempDir(async (dir) => {
    const v1 = await codeHashOf("token-v1.wasm");
    const base = { tokens: [DEMO], network: "testnet", dataDir: dir, log: quiet };

    // Before: the same real account, reconstructed with v1's code hash.
    await runScan({ ...base, snapshotOpts: { fetchImpl: recordedChain({ [DEMO]: v1 }) } });
    // After: the account exactly as recorded on chain, running v2, master key still held.
    const delivered = [];
    const { alerts } = await runScan({ ...base, snapshotOpts: { fetchImpl: recordedChain() }, deliver: async (a) => delivered.push(...a) });

    assert.deepEqual(alerts.map((a) => [a.severity, a.type]), [["critical", "UNILATERAL_RECOMPILE"]]);
    assert.equal(delivered.length, 1);
    assert.match(alerts[0].message, /DEMO \(smoke-demo-degen\.testnet\)/);
  }));

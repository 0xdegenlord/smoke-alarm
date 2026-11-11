import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeChain } from "./fake-chain.js";
import { runScan } from "../src/scan.js";
import { rpcCall } from "../src/rpc.js";
import { createStore } from "../src/store.js";

const quiet = () => {};
const noSleep = async () => {};

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "smoke-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("end to end: baseline, then a rug-style code swap fires the alarm", () =>
  withTempDir(async (dir) => {
    const chain = createFakeChain({
      "demo.testnet": { codeHash: "GOOD", keys: [{ pk: "ed25519:owner", full: true }], symbol: "DEMO", supply: 1000, holders: [300, 200, 100] },
      "safe.testnet": { codeHash: "SAFE", keys: [], symbol: "SAFE", supply: 1000, holders: [100] },
    });
    const opts = { tokens: ["demo.testnet", "safe.testnet"], dataDir: dir, log: quiet, snapshotOpts: { fetchImpl: chain.fetchImpl, sleepImpl: noSleep } };

    const first = await runScan(opts);
    assert.deepEqual(first.alerts, []);
    assert.equal(first.events.filter((e) => e.type === "BASELINE").length, 2);

    const snaps = await createStore(dir).loadSnapshots();
    assert.equal(snaps["demo.testnet"].top10Share, 60);
    assert.deepEqual(snaps["demo.testnet"].fullAccessKeys, ["ed25519:owner"]);

    chain.accounts["demo.testnet"].codeHash = "EVIL";
    const second = await runScan(opts);
    assert.deepEqual(second.alerts.map((a) => [a.token, a.type]), [["demo.testnet", "UNILATERAL_RECOMPILE"]]);

    const third = await runScan(opts);
    assert.deepEqual(third.alerts, [], "the same change should not alert twice");

    const log = await createStore(dir).loadEvents();
    assert.equal(log.filter((e) => e.type === "UNILATERAL_RECOMPILE").length, 1);
  }));

test("a token that does not exist is recorded, not a crash", () =>
  withTempDir(async (dir) => {
    const chain = createFakeChain({});
    const { events } = await runScan({ tokens: ["ghost.near"], dataDir: dir, log: quiet, snapshotOpts: { fetchImpl: chain.fetchImpl } });
    assert.equal(events[0].type, "BASELINE");
    const snaps = await createStore(dir).loadSnapshots();
    assert.equal(snaps["ghost.near"].exists, false);
  }));

test("rate-limited calls back off and retry instead of failing", async () => {
  const chain = createFakeChain({ "a.near": { codeHash: "X", keys: [], symbol: "A", supply: 1, holders: [] } });
  chain.rateLimit(2);
  const slept = [];
  const result = await rpcCall(
    "query",
    { request_type: "view_account", finality: "final", account_id: "a.near" },
    { fetchImpl: chain.fetchImpl, sleepImpl: async (ms) => slept.push(ms), baseDelayMs: 100 },
  );
  assert.equal(result.code_hash, "X");
  assert.deepEqual(slept, [100, 200]);
});

test("rate limiting that never clears gives up with an error", async () => {
  const chain = createFakeChain({ "a.near": { codeHash: "X", keys: [], symbol: "A", supply: 1, holders: [] } });
  chain.rateLimit(99);
  await assert.rejects(
    rpcCall("query", { request_type: "view_account", finality: "final", account_id: "a.near" }, { fetchImpl: chain.fetchImpl, sleepImpl: noSleep, retries: 2 }),
    /Rate limits/,
  );
});

test("if sending the alert fails, nothing is saved, so the next scan alerts again", () =>
  withTempDir(async (dir) => {
    const chain = createFakeChain({
      "demo.testnet": { codeHash: "GOOD", keys: [{ pk: "ed25519:owner", full: true }], symbol: "DEMO", supply: 1000, holders: [] },
    });
    const opts = { tokens: ["demo.testnet"], dataDir: dir, log: quiet, snapshotOpts: { fetchImpl: chain.fetchImpl } };
    await runScan(opts);
    chain.accounts["demo.testnet"].codeHash = "EVIL";

    const broken = async () => {
      throw new Error("Telegram is down");
    };
    await assert.rejects(runScan({ ...opts, deliver: broken }), /Telegram is down/);

    const delivered = [];
    const retry = await runScan({ ...opts, deliver: async (a) => delivered.push(...a) });
    assert.deepEqual(retry.alerts.map((a) => a.type), ["UNILATERAL_RECOMPILE"]);
    assert.equal(delivered.length, 1, "the alert is delivered on the next scan instead of being lost");
  }));

test("a scan reports which tokens could not be checked", () =>
  withTempDir(async (dir) => {
    const failing = async () => {
      throw new Error("network down");
    };
    const r = await runScan({ tokens: ["a.near", "b.near", "a.near"], dataDir: dir, log: quiet, snapshotOpts: { fetchImpl: failing } });
    assert.deepEqual(r.failed, ["a.near", "b.near"], "duplicates in the watchlist are scanned once");
    assert.deepEqual(r.events, []);
  }));

test("a corrupted line in the event log is skipped, not fatal", () =>
  withTempDir(async (dir) => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, "events.jsonl"), '{"type":"A"}\n{"type":"B"\n{"type":"C"}\n');
    const origWarn = console.warn;
    console.warn = () => {};
    try {
      const events = await createStore(dir).loadEvents();
      assert.deepEqual(events.map((e) => e.type), ["A", "C"]);
    } finally {
      console.warn = origWarn;
    }
  }));

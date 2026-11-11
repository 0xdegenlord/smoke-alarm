import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, shouldAlert } from "../src/classify.js";

const base = {
  token: "tok.near",
  takenAt: "2026-11-09T00:00:00Z",
  exists: true,
  codeHash: "AAA",
  hasContract: true,
  fullAccessKeys: [],
  functionCallKeys: 0,
  symbol: "TOK",
  top10Share: 40,
};
const types = (events) => events.map((e) => e.type);

test("first snapshot is a silent baseline", () => {
  const ev = classify(undefined, base);
  assert.deepEqual(types(ev), ["BASELINE"]);
  assert.equal(shouldAlert(ev[0]), false);
});

test("nothing changed means no events", () => {
  assert.deepEqual(classify(base, { ...base }), []);
});

test("code change with no master key is a warning, not silence", () => {
  const ev = classify(base, { ...base, codeHash: "BBB" });
  assert.deepEqual(types(ev), ["UPGRADE_NO_KEYS"]);
  assert.equal(ev[0].severity, "warn");
  assert.equal(shouldAlert(ev[0]), true);
});

test("a recreated account with master keys is critical", () => {
  const gone = { token: base.token, takenAt: base.takenAt, exists: false };
  const ev = classify(gone, { ...base, fullAccessKeys: ["ed25519:k1"] });
  assert.deepEqual(types(ev), ["ACCOUNT_CREATED"]);
  assert.equal(ev[0].severity, "critical");
});

test("a recreated account without keys still warns", () => {
  const gone = { token: base.token, takenAt: base.takenAt, exists: false };
  assert.equal(classify(gone, base)[0].severity, "warn");
});

test("code change while a master key exists is the real alarm", () => {
  const prev = { ...base, fullAccessKeys: ["ed25519:k1"] };
  const ev = classify(prev, { ...prev, codeHash: "BBB" });
  assert.deepEqual(types(ev), ["UNILATERAL_RECOMPILE"]);
  assert.equal(ev[0].severity, "critical");
});

test("a new master key on a locked token is critical", () => {
  const ev = classify(base, { ...base, fullAccessKeys: ["ed25519:k9"] });
  assert.deepEqual(types(ev), ["NEW_FULL_ACCESS_KEY"]);
});

test("a key swap with the same count is still caught", () => {
  const prev = { ...base, fullAccessKeys: ["ed25519:k1"] };
  const ev = classify(prev, { ...prev, fullAccessKeys: ["ed25519:k2"] });
  assert.deepEqual(types(ev), ["NEW_FULL_ACCESS_KEY"]);
});

test("adding a key and swapping code in one go raises both", () => {
  const ev = classify(base, { ...base, fullAccessKeys: ["ed25519:k9"], codeHash: "BBB" });
  assert.deepEqual(types(ev).sort(), ["NEW_FULL_ACCESS_KEY", "UNILATERAL_RECOMPILE"]);
});

test("removing all master keys is good news", () => {
  const prev = { ...base, fullAccessKeys: ["ed25519:k1"] };
  const ev = classify(prev, { ...prev, fullAccessKeys: [] });
  assert.deepEqual(types(ev), ["KEYS_REMOVED"]);
  assert.equal(ev[0].severity, "good");
});

test("code removed entirely is critical", () => {
  const ev = classify(base, { ...base, codeHash: "11111111111111111111111111111111", hasContract: false });
  assert.deepEqual(types(ev), ["CONTRACT_REMOVED"]);
});

test("account disappearing is critical", () => {
  const ev = classify(base, { token: base.token, takenAt: base.takenAt, exists: false });
  assert.deepEqual(types(ev), ["ACCOUNT_DELETED"]);
});

test("holder concentration jump of 10+ points warns, smaller does not", () => {
  assert.deepEqual(types(classify(base, { ...base, top10Share: 50 })), ["CONCENTRATION_UP"]);
  assert.deepEqual(classify(base, { ...base, top10Share: 49.9 }), []);
});

test("missing holder data never triggers a concentration warning", () => {
  assert.deepEqual(classify(base, { ...base, top10Share: null }), []);
});

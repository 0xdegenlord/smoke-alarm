import { test } from "node:test";
import assert from "node:assert/strict";
import { notify, packMessages, formatAlert } from "../src/notify.js";
import { parseArgs } from "../src/scan.js";

const alert = {
  severity: "critical",
  type: "UNILATERAL_RECOMPILE",
  token: "demo.testnet",
  at: "2026-11-09T00:00:00Z",
  message: "DEMO (demo.testnet): the token's code changed while someone held a master key.",
};

test("an alert message says what happened and links to the token", () => {
  const text = formatAlert(alert, "testnet");
  assert.match(text, /^CRITICAL: UNILATERAL_RECOMPILE/);
  assert.match(text, /testnet\.nearblocks\.io\/address\/demo\.testnet/);
});

test("without a bot configured, alerts are printed, not lost", async () => {
  const printed = [];
  const r = await notify([alert], { env: {}, log: (s) => printed.push(s), fetchImpl: () => assert.fail("should not call Telegram") });
  assert.equal(r.mode, "console");
  assert.ok(printed.some((s) => s.includes("UNILATERAL_RECOMPILE")));
});

test("with a bot configured, alerts are sent to the right chat", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ ok: true }) };
  };
  const r = await notify([alert], { env: { TELEGRAM_BOT_TOKEN: "123:abc", TELEGRAM_CHAT_ID: "42" }, fetchImpl });
  assert.equal(r.sent, 1);
  assert.equal(calls[0].url, "https://api.telegram.org/bot123:abc/sendMessage");
  assert.equal(calls[0].body.chat_id, "42");
  assert.match(calls[0].body.text, /UNILATERAL_RECOMPILE/);
});

test("a Telegram error is reported without leaking the bot token", async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({ ok: false, description: "Unauthorized" }) });
  await assert.rejects(
    notify([alert], { env: { TELEGRAM_BOT_TOKEN: "123:secret", TELEGRAM_CHAT_ID: "42" }, fetchImpl }),
    (e) => /Unauthorized/.test(e.message) && !e.message.includes("secret"),
  );
});

test("no alerts means no messages at all", async () => {
  const r = await notify([], { env: { TELEGRAM_BOT_TOKEN: "x", TELEGRAM_CHAT_ID: "1" }, fetchImpl: () => assert.fail() });
  assert.equal(r.mode, "none");
});

test("many alerts are split to stay under Telegram's size limit", () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ ...alert, token: `t${i}.near` }));
  const msgs = packMessages(many);
  assert.ok(msgs.length > 1);
  assert.ok(msgs.every((m) => m.length <= 4096));
  assert.equal(msgs.join("\n\n").split("UNILATERAL_RECOMPILE").length - 1, 60);
});

test("command line flags are read correctly", () => {
  assert.deepEqual(parseArgs(["--network", "testnet", "--every", "10", "a.testnet"]), { network: "testnet", every: 10, tokens: ["a.testnet"] });
  assert.deepEqual(parseArgs(["--network=testnet", "a.testnet"]), { network: "testnet", every: undefined, tokens: ["a.testnet"] });
  assert.deepEqual(parseArgs([]), { network: "mainnet", every: undefined, tokens: [] });
  assert.deepEqual(parseArgs(["--help"]), { help: true });
  assert.throws(() => parseArgs(["--network", "moon", "x"]), /Unknown network/);
  assert.throws(() => parseArgs(["--every", "1"]), /from 5 to 86400/);
  assert.throws(() => parseArgs(["--every", "99999999"]), /from 5 to 86400/);
  assert.throws(() => parseArgs(["--every"]), /needs a value/);
  assert.throws(() => parseArgs(["--evry", "5"]), /Unknown option/);
  assert.throws(() => parseArgs(["--network", "testnet"]), /Name the testnet account/);
});

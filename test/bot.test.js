import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { _test } from "../bot/worker.js";

function fakeKV() {
  const m = new Map();
  return {
    m,
    async get(k, t) { const v = m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
  };
}

// A fake NEAR network plus a fake Telegram, behind one fetch.
function fakeWorld() {
  const chain = { "smoke-demo-degen.testnet": { code: "V1", keys: ["ed25519:A"], symbol: "DEMO" } };
  const sent = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    if (String(url).includes("api.telegram.org")) { sent.push(body); return Response.json({ ok: true, result: { username: "x" } }); }
    const p = body.params, acc = chain[p.account_id];
    if (!acc) return Response.json({ jsonrpc: "2.0", error: { cause: { name: "UNKNOWN_ACCOUNT" } } });
    if (p.request_type === "view_account") return Response.json({ result: { code_hash: acc.code } });
    if (p.request_type === "view_access_key_list") return Response.json({ result: { keys: acc.keys.map((k) => ({ public_key: k, access_key: { permission: "FullAccess" } })) } });
    if (p.request_type === "call_function") return Response.json({ result: { result: [...new TextEncoder().encode(JSON.stringify({ symbol: acc.symbol }))] } });
  };
  return { chain, sent, fetchImpl };
}

async function say(env, chatId, text) {
  const secret = await _test.webhookSecret(env);
  const req = new Request("https://bot.example/telegram", {
    method: "POST",
    headers: { "X-Telegram-Bot-Api-Secret-Token": secret },
    body: JSON.stringify({ message: { chat: { id: chatId }, text } }),
  });
  return (await (await worker.fetch(req, env)).json()).text;
}

test("watch, swap code, only the watcher gets the alert, stop", async () => {
  const w = fakeWorld();
  globalThis.fetch = w.fetchImpl;
  const env = { DB: fakeKV(), BOT_TOKEN: "t" };

  assert.match(await say(env, 1, "/start"), /\/watch/);
  const r = await say(env, 1, "/watch smoke-demo-degen.testnet");
  assert.match(r, /DEMO \(smoke-demo-degen.testnet\) on testnet/);
  assert.match(r, /1 master key/);
  assert.match(r, /Watching it now/);
  assert.match(await say(env, 1, "/watch smoke-demo-degen.testnet"), /already watch/);
  assert.match(await say(env, 2, "/check smoke-demo-degen.testnet"), /Send \/watch/);
  assert.match(await say(env, 1, "/list"), /smoke-demo-degen.testnet/);
  assert.match(await say(env, 3, "/watch nope.testnet"), /does not exist/);
  assert.match(await say(env, 3, "/watch BAD!!"), /doesn't look like/);

  // Nothing changed: no alerts.
  await _test.runScan(env, 0);
  assert.equal(w.sent.length, 0);

  // Code swap: chat 1 alerted, chat 2 (who only checked) not.
  w.chain["smoke-demo-degen.testnet"].code = "V2";
  await _test.runScan(env, 60000);
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].chat_id, 1);
  assert.match(w.sent[0].text, /UNILATERAL_RECOMPILE/);
  assert.match(w.sent[0].text, /DEMO/);

  // Same state again: no duplicate.
  await _test.runScan(env, 120000);
  assert.equal(w.sent.length, 1);

  assert.match(await say(env, 1, "/stop smoke-demo-degen.testnet"), /Stopped/);
  assert.equal(env.DB.m.get("idx"), "[]");
  w.chain["smoke-demo-degen.testnet"].code = "V3";
  await _test.runScan(env, 180000);
  assert.equal(w.sent.length, 1);
});

test("rejects requests without Telegram's secret", async () => {
  const env = { DB: fakeKV(), BOT_TOKEN: "t" };
  const res = await worker.fetch(new Request("https://bot.example/telegram", { method: "POST", body: "{}" }), env);
  assert.equal(res.status, 403);
});

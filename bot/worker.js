// Smoke Alarm Telegram bot, running on Cloudflare Workers (free plan).
//
// Anyone can open the bot and send:
//   /watch <token>   start getting alerts for a NEAR token
//   /check <token>   one-time check, no alerts
//   /list            the tokens you watch
//   /stop <token>    stop alerts for a token
//
// Every minute a Cron Trigger checks watched tokens and messages only the people watching
// the token that changed. Subscriptions live in Workers KV, so nobody's chat ID is public.
//
// Needs: a KV binding named DB, a secret named BOT_TOKEN, and a Cron Trigger "* * * * *".
// After deploying, open https://<your-worker>/setup once to connect the bot to Telegram.
//
// One file, no dependencies, so it can be pasted straight into the Cloudflare dashboard.

const RPC = {
  mainnet: ["https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org"],
  testnet: ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"],
};
const EXPLORER = {
  mainnet: (a) => `https://nearblocks.io/address/${a}`,
  testnet: (a) => `https://testnet.nearblocks.io/address/${a}`,
};
const EMPTY_CODE_HASH = "11111111111111111111111111111111";

// The free plan allows 50 outgoing requests per run. Each token costs 2 (code + keys),
// so one run checks up to 15 tokens and keeps 20 for sending alerts.
const TOKENS_PER_RUN = 15;
const MAX_TOKENS_PER_USER = 10;
const MAX_TOKENS_TOTAL = 300;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/telegram" && request.method === "POST") return handleTelegram(request, env);
    if (url.pathname === "/setup") return handleSetup(url, env);
    const idx = await getIndex(env);
    return new Response(`Smoke Alarm bot is running. Watching ${idx.length} token(s).\n`, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScan(env, event.scheduledTime));
  },
};

// ---------- Telegram commands ----------

async function handleTelegram(request, env) {
  if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== (await webhookSecret(env))) {
    return new Response("forbidden", { status: 403 });
  }
  const update = await request.json().catch(() => null);
  const msg = update?.message;
  if (!msg?.text || !msg.chat) return new Response("ok");

  const chatId = msg.chat.id;
  const [rawCmd, rawArg] = msg.text.trim().split(/\s+/, 2);
  const cmd = rawCmd.toLowerCase().replace(/@.*$/, ""); // "/watch@SomeBot" in groups
  const arg = (rawArg ?? "").toLowerCase();

  let text;
  try {
    if (cmd === "/start" || cmd === "/help") text = helpText();
    else if (cmd === "/watch") text = await cmdWatch(env, chatId, arg);
    else if (cmd === "/check") text = await cmdCheck(arg);
    else if (cmd === "/list") text = await cmdList(env, chatId);
    else if (cmd === "/stop") text = await cmdStop(env, chatId, arg);
    else if (looksLikeAccount(msg.text.trim().toLowerCase())) text = await cmdCheck(msg.text.trim().toLowerCase());
    else text = "I didn't get that. Send /help to see what I can do.";
  } catch (e) {
    text = "Something went wrong while checking NEAR. Please try again in a minute.";
  }

  // Replying in the webhook response saves an outgoing request.
  return Response.json({ method: "sendMessage", chat_id: chatId, text, disable_web_page_preview: true });
}

function helpText() {
  return [
    "Smoke Alarm watches NEAR tokens and tells you when someone can change, or just changed, the code behind a token.",
    "",
    "/watch blackdragon.tkn.near  get alerts for a token",
    "/check blackdragon.tkn.near  check a token once",
    "/list  tokens you watch",
    "/stop blackdragon.tkn.near  stop alerts",
    "",
    "Try it on our demo token, whose code we swap on purpose: /watch smoke-demo-degen.testnet",
  ].join("\n");
}

async function cmdCheck(account) {
  const err = validate(account);
  if (err) return err;
  const snap = await takeSnapshot(account);
  return describe(snap) + "\n\nSend /watch " + account + " to get alerts when this changes.";
}

async function cmdWatch(env, chatId, account) {
  const err = validate(account);
  if (err) return err;

  const mine = (await env.DB.get(`u:${chatId}`, "json")) ?? [];
  if (mine.includes(account)) return `You already watch ${account}. Send /list to see your tokens.`;
  if (mine.length >= MAX_TOKENS_PER_USER) return `You can watch up to ${MAX_TOKENS_PER_USER} tokens. Send /stop <token> to make room.`;

  const idx = await getIndex(env);
  const isNew = !idx.includes(account);
  if (isNew && idx.length >= MAX_TOKENS_TOTAL) return "The bot is full right now. Please try again later.";

  const snap = await takeSnapshot(account);
  if (!snap.exists) return `${account} does not exist on ${snap.network}.`;
  if (!snap.hasContract) return `${account} has no code deployed, so it is not a token.`;

  const entry = (await env.DB.get(`w:${account}`, "json")) ?? { subs: [], snap };
  if (!entry.subs.includes(chatId)) entry.subs.push(chatId);
  await env.DB.put(`w:${account}`, JSON.stringify(entry));
  await env.DB.put(`u:${chatId}`, JSON.stringify([...mine, account]));
  if (isNew) await env.DB.put("idx", JSON.stringify([...idx, account]));

  const minutes = Math.max(1, Math.ceil((idx.length + (isNew ? 1 : 0)) / TOKENS_PER_RUN));
  return (
    describe(snap) +
    `\n\nWatching it now. I'll message you if its code or master keys change. Checked about every ${minutes === 1 ? "minute" : `${minutes} minutes`}.`
  );
}

async function cmdList(env, chatId) {
  const mine = (await env.DB.get(`u:${chatId}`, "json")) ?? [];
  if (mine.length === 0) return "You don't watch any tokens yet. Send /watch <token> to start.";
  return "You watch:\n" + mine.map((a) => `• ${a}`).join("\n") + "\n\nSend /stop <token> to stop one.";
}

async function cmdStop(env, chatId, account) {
  if (!account) return "Tell me which token, for example: /stop blackdragon.tkn.near";
  const mine = (await env.DB.get(`u:${chatId}`, "json")) ?? [];
  if (!mine.includes(account)) return `You don't watch ${account}.`;
  await env.DB.put(`u:${chatId}`, JSON.stringify(mine.filter((a) => a !== account)));

  const entry = await env.DB.get(`w:${account}`, "json");
  if (entry) {
    entry.subs = entry.subs.filter((c) => c !== chatId);
    if (entry.subs.length === 0) {
      await env.DB.delete(`w:${account}`);
      const idx = await getIndex(env);
      await env.DB.put("idx", JSON.stringify(idx.filter((a) => a !== account)));
    } else {
      await env.DB.put(`w:${account}`, JSON.stringify(entry));
    }
  }
  return `Stopped. You won't get alerts for ${account} anymore.`;
}

function describe(s) {
  const name = s.symbol ? `${s.symbol} (${s.token})` : s.token;
  if (!s.exists) return `${s.token} does not exist on ${s.network}.`;
  if (!s.hasContract) return `${s.token} has no code deployed, so it is not a token.`;
  const keys = s.fullAccessKeys.length;
  const verdict =
    keys === 0
      ? "🟢 Locked. Nobody holds a master key, so nobody can swap its code with a key."
      : `🔴 ${keys} master key(s) held. Whoever holds one can replace this token's code at any time.`;
  return [`${name} on ${s.network}`, verdict, `Code fingerprint: ${s.codeHash}`, EXPLORER[s.network](s.token)].join("\n");
}

// ---------- Scheduled scan ----------

async function runScan(env, scheduledTime) {
  const idx = await getIndex(env);
  if (idx.length === 0) return;

  // Rotate through the list in slices of TOKENS_PER_RUN, one slice per minute, with no writes.
  const slices = Math.ceil(idx.length / TOKENS_PER_RUN);
  const slice = Math.floor(scheduledTime / 60000) % slices;
  const batch = idx.slice(slice * TOKENS_PER_RUN, (slice + 1) * TOKENS_PER_RUN);

  let sendBudget = 50 - 2 * batch.length;
  for (const account of batch) {
    const entry = await env.DB.get(`w:${account}`, "json");
    if (!entry) continue;

    let curr;
    try {
      curr = await takeSnapshot(account, { withSymbol: false });
    } catch {
      continue; // NEAR did not answer. Try again next time.
    }
    curr.symbol = entry.snap?.symbol ?? null;

    const events = classify(entry.snap, curr);
    if (events.length === 0) continue;

    // Alert before saving, so a failed send is retried next time instead of lost.
    let allSent = true;
    for (const chatId of entry.subs) {
      if (sendBudget <= 0) {
        allSent = false;
        break;
      }
      sendBudget--;
      const ok = await sendMessage(env, chatId, alertText(events, curr));
      if (!ok) allSent = false;
    }
    if (allSent) {
      entry.snap = curr;
      await env.DB.put(`w:${account}`, JSON.stringify(entry));
    }
  }
}

function alertText(events, s) {
  const icon = { critical: "🚨", warn: "⚠️", good: "✅" };
  return (
    events.map((e) => `${icon[e.severity] ?? ""} ${e.severity.toUpperCase()}: ${e.type}\n${e.message}`).join("\n\n") +
    `\n\nSeen: ${new Date().toISOString()}\n${EXPLORER[s.network](s.token)}`
  );
}

// Same rules as src/classify.js, limited to code and key changes.
function classify(prev, curr) {
  const name = curr.symbol ? `${curr.symbol} (${curr.token})` : curr.token;
  const ev = (severity, type, message) => ({ severity, type, message });
  if (!prev) return [];
  if (prev.exists && !curr.exists) return [ev("critical", "ACCOUNT_DELETED", `${name}: the token's account no longer exists.`)];
  if (!prev.exists && curr.exists) {
    return curr.fullAccessKeys.length > 0
      ? [ev("critical", "ACCOUNT_CREATED", `${name}: the account was created again and has ${curr.fullAccessKeys.length} master key(s).`)]
      : [ev("warn", "ACCOUNT_CREATED", `${name}: the account was created again. Treat it as a new token.`)];
  }
  if (!prev.exists && !curr.exists) return [];

  const events = [];
  const had = new Set(prev.fullAccessKeys);
  const added = curr.fullAccessKeys.filter((k) => !had.has(k));
  if (added.length > 0) {
    events.push(ev("critical", "NEW_FULL_ACCESS_KEY", `${name}: ${added.length} new master key(s) added. Whoever holds it can replace the token's code.`));
  }
  if (prev.fullAccessKeys.length > 0 && curr.fullAccessKeys.length === 0) {
    events.push(ev("good", "KEYS_REMOVED", `${name}: all master keys removed. The code can no longer be swapped by a key holder.`));
  }
  if (prev.codeHash !== curr.codeHash) {
    if (prev.hasContract && !curr.hasContract) {
      events.push(ev("critical", "CONTRACT_REMOVED", `${name}: the token's code was removed.`));
    } else if (prev.fullAccessKeys.length > 0 || curr.fullAccessKeys.length > 0) {
      events.push(ev("critical", "UNILATERAL_RECOMPILE", `${name}: the token's code changed while someone held a master key. One person could have rewritten the rules.`));
    } else {
      events.push(ev("warn", "UPGRADE_NO_KEYS", `${name}: the token's code changed with no master key present, so the contract replaced its own code through one of its methods.`));
    }
  }
  return events;
}

// ---------- NEAR ----------

function networkOf(account) {
  return account.endsWith(".testnet") ? "testnet" : "mainnet";
}

async function takeSnapshot(token, { withSymbol = true } = {}) {
  const network = networkOf(token);
  const base = { token, network, exists: true };
  let account;
  try {
    account = await rpc(network, { request_type: "view_account", finality: "final", account_id: token });
  } catch (e) {
    if (/UNKNOWN_ACCOUNT|does not exist/i.test(String(e.message))) return { ...base, exists: false };
    throw e;
  }
  const keys = await rpc(network, { request_type: "view_access_key_list", finality: "final", account_id: token });
  const snap = {
    ...base,
    codeHash: account.code_hash,
    hasContract: account.code_hash !== EMPTY_CODE_HASH,
    fullAccessKeys: keys.keys.filter((k) => k.access_key.permission === "FullAccess").map((k) => k.public_key).sort(),
    symbol: null,
  };
  if (withSymbol && snap.hasContract) {
    try {
      const r = await rpc(network, {
        request_type: "call_function",
        finality: "final",
        account_id: token,
        method_name: "ft_metadata",
        args_base64: btoa("{}"),
      });
      snap.symbol = JSON.parse(new TextDecoder().decode(new Uint8Array(r.result))).symbol ?? null;
    } catch {}
  }
  return snap;
}

async function rpc(network, params) {
  let lastError;
  for (const url of RPC[network]) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "smoke-alarm", method: "query", params }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) {
        const e = new Error(JSON.stringify(json.error).slice(0, 300));
        e.isRpcError = true;
        throw e;
      }
      if (json.result?.error) {
        const e = new Error(String(json.result.error));
        e.isRpcError = true;
        throw e;
      }
      return json.result;
    } catch (e) {
      if (e.isRpcError) throw e;
      lastError = e;
    }
  }
  throw new Error(`NEAR RPC unavailable: ${lastError?.message}`);
}

const ACCOUNT_RE = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const looksLikeAccount = (s) => ACCOUNT_RE.test(s) && (s.includes(".") || /^[0-9a-f]{64}$/.test(s));

function validate(account) {
  if (!account) return "Tell me which token, for example: /watch blackdragon.tkn.near";
  if (!looksLikeAccount(account)) return `"${account}" doesn't look like a NEAR account. Example: blackdragon.tkn.near`;
  return null;
}

// ---------- Storage and Telegram plumbing ----------

async function getIndex(env) {
  return (await env.DB.get("idx", "json")) ?? [];
}

async function sendMessage(env, chatId, text) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    // 403 means the person blocked the bot. Count it as delivered so it doesn't retry forever.
    return res.ok || res.status === 403;
  } catch {
    return false;
  }
}

// A secret only Telegram and this Worker know, derived from the bot token.
async function webhookSecret(env) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`smoke-alarm:${env.BOT_TOKEN}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 48);
}

async function handleSetup(url, env) {
  if (!env.BOT_TOKEN) return new Response("BOT_TOKEN secret is missing.\n", { status: 500 });
  if (!env.DB) return new Response("KV binding DB is missing.\n", { status: 500 });
  const api = (method, body) =>
    fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json());

  const hook = await api("setWebhook", {
    url: `${url.origin}/telegram`,
    secret_token: await webhookSecret(env),
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });
  const cmds = await api("setMyCommands", {
    commands: [
      { command: "watch", description: "Get alerts for a NEAR token" },
      { command: "check", description: "Check a token once" },
      { command: "list", description: "Tokens you watch" },
      { command: "stop", description: "Stop alerts for a token" },
      { command: "help", description: "How it works" },
    ],
  });
  const me = await api("getMe", {});
  const ok = hook.ok && cmds.ok && me.ok;
  return new Response(
    ok
      ? `Connected. Open https://t.me/${me.result.username} and send /start.\n`
      : `Setup failed: ${JSON.stringify({ hook, cmds, me: me.ok })}\n`,
    { status: ok ? 200 : 500, headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}

// Exported for tests only.
export const _test = { classify, takeSnapshot, validate, looksLikeAccount, describe, runScan, handleTelegram, webhookSecret };

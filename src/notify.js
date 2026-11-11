// Sends alerts to Telegram. If no bot is configured, alerts are printed instead,
// so the project still runs end to end for anyone without a Telegram bot.
//
// Needs two environment variables:
//   TELEGRAM_BOT_TOKEN  from @BotFather
//   TELEGRAM_CHAT_ID    run `npm run telegram:chat-id` after messaging your bot once

const TITLE = { critical: "CRITICAL", warn: "WARNING", good: "GOOD NEWS" };
const MAX_MESSAGE = 3900; // Telegram's limit is 4096 characters

export function explorerUrl(token, network = "mainnet") {
  const host = network === "testnet" ? "testnet.nearblocks.io" : "nearblocks.io";
  return `https://${host}/address/${token}`;
}

export function formatAlert(alert, network = "mainnet") {
  return [
    `${TITLE[alert.severity] ?? alert.severity.toUpperCase()}: ${alert.type}`,
    alert.message,
    `Seen: ${alert.at}`,
    explorerUrl(alert.token, network),
  ].join("\n");
}

// Packs alerts into as few messages as possible without passing Telegram's size limit.
export function packMessages(alerts, network = "mainnet") {
  const messages = [];
  let current = "";
  for (const a of alerts) {
    const block = formatAlert(a, network);
    if (current && current.length + block.length + 2 > MAX_MESSAGE) {
      messages.push(current);
      current = "";
    }
    current = current ? `${current}\n\n${block}` : block;
  }
  if (current) messages.push(current);
  return messages;
}

export async function notify(alerts, { env = process.env, fetchImpl = fetch, log = console.log, network = "mainnet" } = {}) {
  if (alerts.length === 0) return { sent: 0, mode: "none" };
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  const messages = packMessages(alerts, network);

  if (!token || !chatId) {
    log("\n(Telegram not configured, printing alerts instead)\n");
    for (const m of messages) log(m + "\n");
    return { sent: 0, mode: "console" };
  }

  let sent = 0;
  for (const text of messages) {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    const body = await res.json().catch(() => ({}));
    // Never print the bot token. Telegram's own error text is safe to show.
    if (!res.ok || body.ok === false) throw new Error(`Telegram refused the message: ${body.description ?? `HTTP ${res.status}`}`);
    sent++;
  }
  return { sent, mode: "telegram" };
}

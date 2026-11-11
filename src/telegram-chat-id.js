#!/usr/bin/env node
// Prints the chat ID(s) that have messaged your bot, so you can set TELEGRAM_CHAT_ID.
// 1. Open your bot in Telegram and send it any message, like "hi".
// 2. Run: npm run telegram:chat-id
import { loadEnvFile } from "./env.js";

loadEnvFile();
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Set TELEGRAM_BOT_TOKEN first (in .env or your shell). Get one from @BotFather.");
  process.exit(1);
}

const me = await (await fetch(`https://api.telegram.org/bot${token}/getMe`)).json();
if (!me.ok) {
  console.error(`Telegram said: ${me.description}. Check the token in .env.`);
  process.exit(1);
}
console.log(`Connected to your bot @${me.result.username}. Messages must be sent to THIS bot.\n`);

const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
const body = await res.json();
if (!body.ok) {
  console.error(`Telegram said: ${body.description}`);
  process.exit(1);
}

const chats = new Map();
for (const u of body.result) {
  const chat = (u.message ?? u.channel_post ?? u.my_chat_member)?.chat;
  if (chat) chats.set(chat.id, chat.title ?? chat.username ?? chat.first_name ?? "");
}
if (chats.size === 0) {
  console.log("No messages yet. Send your bot a message in Telegram, then run this again.");
} else {
  for (const [id, name] of chats) console.log(`TELEGRAM_CHAT_ID=${id}   (${name})`);
}

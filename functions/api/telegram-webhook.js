import { parseCommand, resolveTweetBody, splitStreamTweetPayload } from "../lib/command-parser.js";
import { validateTweet } from "../lib/tweet-validator.js";
import { postTweet as xPostTweet } from "../lib/x-client.js";

export async function onRequestPost(context) {
  const { env, request } = context;

  const secretHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
  if (!env.TELEGRAM_WEBHOOK_SECRET || secretHeader !== env.TELEGRAM_WEBHOOK_SECRET) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  if (!env.STREAM_DB) {
    return json({ ok: false, error: "Missing D1 binding: STREAM_DB" }, 500);
  }

  const update = await request.json();
  const result = await handleTelegramUpdate({ env, update });
  return json({ ok: true, ...result });
}

export async function handleTelegramUpdate({ env, update, deps = {} }) {
  const message = update?.message;
  if (!message) return { ignored: true };

  const chatId = String(message.chat?.id ?? "");
  const allowedChatId = String(env.TELEGRAM_ALLOWED_CHAT_ID || "");
  if (!allowedChatId || chatId !== allowedChatId) return { ignored: true };

  const text = typeof message.text === "string" ? message.text : "";
  const parsed = parseCommand(text);
  if (!parsed) return { ignored: true };

  const sendTelegram = deps.sendTelegram || sendTelegramMessage;
  const postTweetFn = deps.postTweet || ((args) => xPostTweet(args));

  if (parsed.command === "start" || parsed.command === "help") {
    await sendTelegram(env, {
      chat_id: chatId,
      text: "Commands:\n/stream <text> — archive a thought\n/t <text> — post to x.com (also works as a reply to a prior message)",
      reply_to_message_id: message.message_id,
    });
    return { replied: true };
  }

  if (parsed.command === "stream") {
    return handleStream({ env, message, chatId, payload: parsed.payload, update, sendTelegram, postTweetFn });
  }

  if (parsed.command === "t") {
    return handleTweet({ env, message, chatId, payload: parsed.payload, update, sendTelegram, postTweetFn });
  }

  return { ignored: true };
}

async function handleStream({ env, message, chatId, payload, update, sendTelegram, postTweetFn }) {
  const { body, alsoTweet } = splitStreamTweetPayload(payload);

  if (!body) {
    await sendTelegram(env, {
      chat_id: chatId,
      text: "Nothing was published. Send /stream followed by the thought you want to archive.",
      reply_to_message_id: message.message_id,
    });
    return { replied: true };
  }

  let validatedTweet = null;
  if (alsoTweet) {
    const v = validateTweet(body);
    if (!v.ok) {
      await sendTelegram(env, {
        chat_id: chatId,
        text: `Can't tweet: ${v.error}. Nothing was posted or streamed.`,
        reply_to_message_id: message.message_id,
      });
      return { replied: true };
    }
    validatedTweet = v.body;
  }

  const messageDate = new Date((message.date || Math.floor(Date.now() / 1000)) * 1000);
  const createdAtIso = formatIsoForTimeZone(messageDate, env.STREAM_TIMEZONE || "Asia/Kolkata");
  const createdAtEpochMs = messageDate.getTime();
  const updateId = update.update_id ?? null;

  const insert = await env.STREAM_DB.prepare(
    `INSERT OR IGNORE INTO posts (chat_id, telegram_update_id, telegram_message_id, body, created_at_iso, created_at_epoch_ms, is_stream, is_tweet)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
  )
    .bind(chatId, updateId, message.message_id ?? null, body, createdAtIso, createdAtEpochMs, alsoTweet ? 1 : 0)
    .run();

  if (insert?.meta?.changes === 0) {
    return { deduped: true };
  }

  if (!alsoTweet) {
    await sendTelegram(env, { chat_id: chatId, text: "Published.", reply_to_message_id: message.message_id });
    return { published: true };
  }

  try {
    const tweet = await postTweetFn({ body: validatedTweet, env });
    const tweetId = String(tweet?.id ?? "");
    await env.STREAM_DB.prepare(`UPDATE posts SET x_tweet_id = ? WHERE telegram_update_id = ?`)
      .bind(tweetId, updateId)
      .run();
    const handle = env.X_HANDLE || "i";
    await sendTelegram(env, {
      chat_id: chatId,
      text: `Published and posted: https://x.com/${handle}/status/${tweetId}`,
      reply_to_message_id: message.message_id,
    });
    return { published: true, tweeted: true, tweetId };
  } catch (err) {
    const safe = sanitizeError(err);
    await sendTelegram(env, {
      chat_id: chatId,
      text: `Published, but tweet failed: ${safe}`,
      reply_to_message_id: message.message_id,
    });
    return { published: true, tweeted: false, error: safe };
  }
}

async function handleTweet({ env, message, chatId, payload, update, sendTelegram, postTweetFn }) {
  const replyText = message.reply_to_message?.text || message.reply_to_message?.caption || "";
  const body = resolveTweetBody({ payload, replyText });

  if (!body) {
    await sendTelegram(env, {
      chat_id: chatId,
      text: "Nothing to tweet. Use /t <text> or reply to a message with /t.",
      reply_to_message_id: message.message_id,
    });
    return { replied: true };
  }

  const validation = validateTweet(body);
  if (!validation.ok) {
    await sendTelegram(env, {
      chat_id: chatId,
      text: `Can't tweet: ${validation.error}`,
      reply_to_message_id: message.message_id,
    });
    return { replied: true };
  }

  const updateId = update.update_id ?? null;
  const messageDate = new Date((message.date || Math.floor(Date.now() / 1000)) * 1000);
  const createdAtIso = formatIsoForTimeZone(messageDate, env.STREAM_TIMEZONE || "Asia/Kolkata");
  const createdAtEpochMs = messageDate.getTime();

  const insert = await env.STREAM_DB.prepare(
    `INSERT OR IGNORE INTO posts (chat_id, telegram_update_id, telegram_message_id, body, created_at_iso, created_at_epoch_ms, is_stream, is_tweet)
     VALUES (?, ?, ?, ?, ?, ?, 0, 1)`,
  )
    .bind(chatId, updateId, message.message_id ?? null, validation.body, createdAtIso, createdAtEpochMs)
    .run();

  if (insert?.meta?.changes === 0) {
    return { deduped: true };
  }

  try {
    const tweet = await postTweetFn({ body: validation.body, env });
    const tweetId = String(tweet?.id ?? "");

    await env.STREAM_DB.prepare(`UPDATE posts SET x_tweet_id = ? WHERE telegram_update_id = ?`)
      .bind(tweetId, updateId)
      .run();

    const handle = env.X_HANDLE || "i";
    await sendTelegram(env, {
      chat_id: chatId,
      text: `Posted: https://x.com/${handle}/status/${tweetId}`,
      reply_to_message_id: message.message_id,
    });
    return { tweeted: true, tweetId };
  } catch (err) {
    const safeMessage = sanitizeError(err);
    await sendTelegram(env, {
      chat_id: chatId,
      text: `Tweet failed: ${safeMessage}`,
      reply_to_message_id: message.message_id,
    });
    return { tweeted: false, error: safeMessage };
  }
}

function sanitizeError(err) {
  const raw = (err?.message || "tweet failed").slice(0, 200);
  return raw.replace(/[A-Za-z0-9_-]{30,}/g, "[redacted]");
}

function formatIsoForTimeZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "shortOffset",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  );
  const offset = normalizeOffset(parts.timeZoneName || "GMT+00:00");
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

function normalizeOffset(value) {
  if (value === "UTC" || value === "GMT") return "+00:00";
  const match = value.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!match) return "+00:00";
  const sign = match[1];
  const hours = match[2].padStart(2, "0");
  const minutes = (match[3] || "00").padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

async function sendTelegramMessage(env, payload) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

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
  const message = update?.message;

  if (!message) {
    return json({ ok: true, ignored: true });
  }

  const chatId = String(message.chat?.id ?? "");
  const allowedChatId = String(env.TELEGRAM_ALLOWED_CHAT_ID || "");

  if (!allowedChatId || chatId !== allowedChatId) {
    return json({ ok: true, ignored: true });
  }

  const text = typeof message.text === "string" ? message.text.trim() : "";
  const commandMatch = text.match(/^\/([a-zA-Z0-9_]+)(?:@[a-zA-Z0-9_]+)?(?:\s+([\s\S]+))?$/);

  if (!commandMatch) {
    return json({ ok: true, ignored: true });
  }

  const command = commandMatch[1].toLowerCase();
  const payload = (commandMatch[2] || "").trim();

  if (command === "start" || command === "help") {
    await sendTelegramMessage(env, {
      chat_id: chatId,
      text: "Use /stream followed by your thought. Example: /stream The page should feel lighter than the software that made it.",
      reply_to_message_id: message.message_id,
    });

    return json({ ok: true, replied: true });
  }

  if (command !== "stream") {
    return json({ ok: true, ignored: true });
  }

  if (!payload) {
    await sendTelegramMessage(env, {
      chat_id: chatId,
      text: "Nothing was published. Send /stream followed by the thought you want to archive.",
      reply_to_message_id: message.message_id,
    });

    return json({ ok: true, replied: true });
  }

  const messageDate = new Date((message.date || Math.floor(Date.now() / 1000)) * 1000);
  const createdAtIso = formatIsoForTimeZone(messageDate, env.STREAM_TIMEZONE || "Asia/Kolkata");
  const createdAtEpochMs = messageDate.getTime();

  await env.STREAM_DB.prepare(
    `
      INSERT OR IGNORE INTO posts (
        source,
        chat_id,
        telegram_update_id,
        telegram_message_id,
        body,
        created_at_iso,
        created_at_epoch_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  )
    .bind(
      "telegram",
      chatId,
      update.update_id ?? null,
      message.message_id ?? null,
      payload,
      createdAtIso,
      createdAtEpochMs,
    )
    .run();

  await sendTelegramMessage(env, {
    chat_id: chatId,
    text: "Published.",
    reply_to_message_id: message.message_id,
  });

  return json({ ok: true, published: true });
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
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  const offset = normalizeOffset(parts.timeZoneName || "GMT+00:00");
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

function normalizeOffset(value) {
  if (value === "UTC" || value === "GMT") {
    return "+00:00";
  }

  const match = value.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);

  if (!match) {
    return "+00:00";
  }

  const sign = match[1];
  const hours = match[2].padStart(2, "0");
  const minutes = (match[3] || "00").padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

async function sendTelegramMessage(env, payload) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return;
  }

  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

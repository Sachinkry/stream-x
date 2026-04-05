import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const contentRoot = path.join(repoRoot, "content");
const manifestPath = path.join(contentRoot, "manifest.json");
const statePath = path.join(repoRoot, ".stream-state", "telegram.json");

const botToken = requireEnv("TELEGRAM_BOT_TOKEN");
const allowedChatId = requireEnv("TELEGRAM_ALLOWED_CHAT_ID");
const streamTimeZone = process.env.STREAM_TIMEZONE || "Asia/Kolkata";

async function main() {
  const state = await loadState();
  const updates = await fetchUpdates(state.nextUpdateId);

  if (!updates.length) {
    console.log("No Telegram updates to process.");
    return;
  }

  const replies = [];
  let highestUpdateId = state.nextUpdateId - 1;
  let changed = false;

  for (const update of updates) {
    highestUpdateId = Math.max(highestUpdateId, update.update_id);

    const message = update.message;

    if (!message || String(message.chat?.id ?? "") !== allowedChatId) {
      continue;
    }

    const response = await handleMessage(message);

    if (response.changed) {
      changed = true;
    }

    if (response.reply) {
      replies.push({
        chatId: String(message.chat.id),
        text: response.reply,
        replyToMessageId: message.message_id,
      });
    }
  }

  await saveState({
    nextUpdateId: highestUpdateId + 1,
    updatedAt: new Date().toISOString(),
  });

  for (const reply of replies) {
    await sendReply(reply);
  }

  console.log(changed ? "Telegram entries recorded." : "Telegram state updated without new entries.");
}

async function handleMessage(message) {
  const text = typeof message.text === "string" ? message.text.trim() : "";

  if (!text.startsWith("/")) {
    return {
      changed: false,
      reply: "",
    };
  }

  const commandMatch = text.match(/^\/([a-zA-Z0-9_]+)(?:@[a-zA-Z0-9_]+)?(?:\s+([\s\S]+))?$/);

  if (!commandMatch) {
    return {
      changed: false,
      reply: "",
    };
  }

  const command = commandMatch[1].toLowerCase();
  const payload = (commandMatch[2] || "").trim();

  if (command === "start" || command === "help") {
    return {
      changed: false,
      reply: "Use /stream followed by your thought. Example: /stream The page should feel lighter than the software that made it.",
    };
  }

  if (command !== "stream") {
    return {
      changed: false,
      reply: "",
    };
  }

  if (!payload) {
    return {
      changed: false,
      reply: "Nothing was published. Send /stream followed by the thought you want to archive.",
    };
  }

  const messageDate = new Date((message.date || Math.floor(Date.now() / 1000)) * 1000);
  const entryDate = formatZonedDateParts(messageDate, streamTimeZone);
  const relativeFile = path.posix.join("content", entryDate.year, `${entryDate.month}.md`);
  const absoluteFile = path.join(repoRoot, relativeFile);
  const entry = buildEntry(entryDate.isoString, payload);

  await mkdir(path.dirname(absoluteFile), { recursive: true });
  await appendEntry(absoluteFile, entry);
  await ensureManifestContains(relativeFile);

  return {
    changed: true,
    reply: `Published to ${entryDate.year}/${entryDate.month}.md`,
  };
}

function buildEntry(isoString, body) {
  return `---\ndate: ${isoString}\n---\n${body.trim()}\n`;
}

async function appendEntry(filePath, entry) {
  const existing = await readTextIfExists(filePath);

  if (!existing.trim()) {
    await writeFile(filePath, entry, "utf8");
    return;
  }

  const normalized = existing.endsWith("\n") ? existing : `${existing}\n`;
  const separator = normalized.trimEnd().endsWith("===") ? "\n" : "===\n";
  const nextContent = `${normalized}${separator}${entry}`;
  await writeFile(filePath, nextContent, "utf8");
}

async function ensureManifestContains(relativeFile) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const files = Array.isArray(manifest.files) ? [...manifest.files] : [];

  if (!files.includes(relativeFile)) {
    files.push(relativeFile);
    files.sort();
    manifest.files = files;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
}

async function fetchUpdates(offset) {
  const response = await telegramRequest("getUpdates", {
    offset,
    timeout: 0,
    allowed_updates: ["message"],
  });

  if (!response.ok) {
    throw new Error("Telegram API returned a non-ok response for getUpdates.");
  }

  if (!response.result || !Array.isArray(response.result)) {
    throw new Error("Telegram API response did not include an updates array.");
  }

  return response.result;
}

async function sendReply({ chatId, text, replyToMessageId }) {
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text,
    reply_to_message_id: replyToMessageId,
  });
}

async function telegramRequest(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Telegram request ${method} failed with ${response.status}.`);
  }

  return response.json();
}

async function loadState() {
  const saved = await readJsonIfExists(statePath);

  return {
    nextUpdateId: Number.isInteger(saved?.nextUpdateId) ? saved.nextUpdateId : 0,
    updatedAt: saved?.updatedAt || "",
  };
}

async function saveState(state) {
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function formatZonedDateParts(date, timeZone) {
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

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
    isoString: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`,
  };
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

async function readJsonIfExists(filePath) {
  const text = await readTextIfExists(filePath);

  if (!text.trim()) {
    return null;
  }

  return JSON.parse(text);
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return "";
    }

    throw error;
  }
}

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

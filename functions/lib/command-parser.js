const COMMAND_RE = /^\s*\/([a-zA-Z0-9_]+)(?:@[a-zA-Z0-9_]+)?(?:\s+([\s\S]+))?\s*$/;
const STREAM_PREFIX_RE = /^\/stream(?:@[a-zA-Z0-9_]+)?(?:\s+|$)/i;
const TWEET_INFIX_RE = /^\/t(?:@[a-zA-Z0-9_]+)?(?:\s+([\s\S]*))?$/i;

export function parseCommand(text) {
  if (typeof text !== "string") return null;
  const match = text.match(COMMAND_RE);
  if (!match) return null;
  return {
    command: match[1].toLowerCase(),
    payload: (match[2] || "").replace(/\s+$/, ""),
  };
}

export function splitStreamTweetPayload(payload) {
  if (typeof payload !== "string") return { body: "", alsoTweet: false };
  const match = payload.match(TWEET_INFIX_RE);
  if (!match) return { body: payload.trim(), alsoTweet: false };
  return { body: (match[1] || "").trim(), alsoTweet: true };
}

export function resolveTweetBody({ payload, replyText }) {
  const inline = (payload || "").trim();
  if (inline) return inline;

  const reply = typeof replyText === "string" ? replyText.trim() : "";
  if (!reply) return "";

  return reply.replace(STREAM_PREFIX_RE, "").trim();
}

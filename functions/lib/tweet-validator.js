export const MAX_TWEET_WEIGHT = 280;
const URL_WEIGHT = 23;
const URL_RE = /\bhttps?:\/\/\S+/gi;

export function weightedLength(text) {
  if (typeof text !== "string" || text.length === 0) return 0;

  let urlContribution = 0;
  const stripped = text.replace(URL_RE, () => {
    urlContribution += URL_WEIGHT;
    return "";
  });

  let weight = 0;
  for (const ch of stripped) {
    const cp = ch.codePointAt(0);
    if (cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037)) {
      weight += 1;
    } else {
      weight += 2;
    }
  }

  return weight + urlContribution;
}

export function validateTweet(body) {
  if (typeof body !== "string") {
    return { ok: false, error: "Tweet body must be a string." };
  }
  const trimmed = body.trim();
  if (!trimmed) {
    return { ok: false, error: "Tweet body is empty." };
  }
  const length = weightedLength(trimmed);
  if (length > MAX_TWEET_WEIGHT) {
    return { ok: false, error: `Tweet too long (${length}/${MAX_TWEET_WEIGHT}).`, length };
  }
  return { ok: true, body: trimmed, length };
}

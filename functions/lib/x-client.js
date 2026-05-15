const TWEET_URL = "https://api.x.com/2/tweets";

export class XApiError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = "XApiError";
    this.status = status;
  }
}

export async function postTweet({ body, env, fetchImpl = fetch }) {
  requireEnv(env);

  const authorization = await signRequest({ method: "POST", url: TWEET_URL, env });

  const res = await fetchImpl(TWEET_URL, {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ text: body }),
  });

  if (!res.ok) {
    throw new XApiError(`Tweet failed (status ${res.status})`, { status: res.status });
  }

  const payload = await res.json();
  return payload?.data ?? payload;
}

export async function signRequest({ method, url, env, oauthOverrides = {} }) {
  const oauthParams = {
    oauth_consumer_key: env.X_CONSUMER_KEY,
    oauth_nonce: oauthOverrides.oauth_nonce || randomNonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: oauthOverrides.oauth_timestamp || String(Math.floor(Date.now() / 1000)),
    oauth_token: env.X_ACCESS_TOKEN,
    oauth_version: "1.0",
  };

  const paramString = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(oauthParams[k])}`)
    .join("&");

  const baseString = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(paramString),
  ].join("&");

  const signingKey = `${percentEncode(env.X_CONSUMER_SECRET)}&${percentEncode(env.X_ACCESS_TOKEN_SECRET)}`;
  const signature = await hmacSha1Base64(signingKey, baseString);

  const headerParams = { ...oauthParams, oauth_signature: signature };
  const header = Object.keys(headerParams)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(headerParams[k])}"`)
    .join(", ");

  return `OAuth ${header}`;
}

export function percentEncode(value) {
  return encodeURIComponent(String(value)).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

function requireEnv(env) {
  for (const key of ["X_CONSUMER_KEY", "X_CONSUMER_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"]) {
    if (!env?.[key]) throw new XApiError(`Missing ${key}`);
  }
}

function randomNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha1Base64(key, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return base64(new Uint8Array(sig));
}

function base64(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  if (typeof btoa === "function") return btoa(bin);
  return Buffer.from(bin, "binary").toString("base64");
}

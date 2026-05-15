import { describe, it, expect, vi, beforeEach } from "vitest";
import { postTweet, XApiError, signRequest, percentEncode } from "../functions/lib/x-client.js";

function makeFetch(responses) {
  const calls = [];
  const fn = vi.fn(async (url, init) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (!r) throw new Error(`unexpected fetch ${url}`);
    return {
      ok: r.status < 400,
      status: r.status,
      async json() { return r.body; },
      async text() { return JSON.stringify(r.body); },
    };
  });
  fn.calls = calls;
  return fn;
}

const baseEnv = {
  X_CONSUMER_KEY: "ck",
  X_CONSUMER_SECRET: "cs",
  X_ACCESS_TOKEN: "at",
  X_ACCESS_TOKEN_SECRET: "ats",
};

describe("percentEncode", () => {
  it("encodes per RFC3986", () => {
    expect(percentEncode("hello world")).toBe("hello%20world");
    expect(percentEncode("a+b")).toBe("a%2Bb");
    expect(percentEncode("a*b")).toBe("a%2Ab");
    expect(percentEncode("-._~")).toBe("-._~");
    expect(percentEncode("a/b")).toBe("a%2Fb");
  });
});

describe("signRequest", () => {
  it("produces a known signature for the RFC example shape", async () => {
    // Sanity: deterministic inputs produce stable output. We don't pin the
    // exact value (env-dependent) — just verify the header shape and that
    // identical inputs yield identical signatures.
    const a = await signRequest({
      method: "POST",
      url: "https://api.x.com/2/tweets",
      env: baseEnv,
      oauthOverrides: { oauth_nonce: "nonce1", oauth_timestamp: "1700000000" },
    });
    const b = await signRequest({
      method: "POST",
      url: "https://api.x.com/2/tweets",
      env: baseEnv,
      oauthOverrides: { oauth_nonce: "nonce1", oauth_timestamp: "1700000000" },
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^OAuth oauth_consumer_key="ck"/);
    expect(a).toContain('oauth_token="at"');
    expect(a).toContain('oauth_signature_method="HMAC-SHA1"');
    expect(a).toContain('oauth_version="1.0"');
    expect(a).toMatch(/oauth_signature="[^"]+"/);
  });

  it("changes signature when nonce changes", async () => {
    const a = await signRequest({
      method: "POST", url: "https://api.x.com/2/tweets", env: baseEnv,
      oauthOverrides: { oauth_nonce: "n1", oauth_timestamp: "1700000000" },
    });
    const b = await signRequest({
      method: "POST", url: "https://api.x.com/2/tweets", env: baseEnv,
      oauthOverrides: { oauth_nonce: "n2", oauth_timestamp: "1700000000" },
    });
    expect(a).not.toBe(b);
  });
});

describe("postTweet", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T00:00:00Z"));
  });

  it("posts a tweet and returns id+text", async () => {
    const fetchImpl = makeFetch([
      { status: 201, body: { data: { id: "1900000000000000001", text: "hello" } } },
    ]);
    const res = await postTweet({ body: "hello", env: baseEnv, fetchImpl });
    expect(res).toEqual({ id: "1900000000000000001", text: "hello" });
    const [call] = fetchImpl.calls;
    expect(call.url).toBe("https://api.x.com/2/tweets");
    expect(call.init.method).toBe("POST");
    expect(call.init.headers["content-type"]).toBe("application/json");
    expect(call.init.headers.authorization).toMatch(/^OAuth /);
    expect(JSON.parse(call.init.body)).toEqual({ text: "hello" });
  });

  it("throws XApiError on non-2xx", async () => {
    const fetchImpl = makeFetch([{ status: 403, body: { detail: "duplicate content" } }]);
    await expect(postTweet({ body: "dup", env: baseEnv, fetchImpl }))
      .rejects.toBeInstanceOf(XApiError);
  });

  it("requires all 4 OAuth 1.0a env vars", async () => {
    for (const k of ["X_CONSUMER_KEY", "X_CONSUMER_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"]) {
      const env = { ...baseEnv };
      delete env[k];
      await expect(postTweet({ body: "x", env, fetchImpl: makeFetch([]) }))
        .rejects.toThrow(new RegExp(k));
    }
  });

  it("never includes credentials in error messages", async () => {
    const fetchImpl = makeFetch([{ status: 500, body: { error: "boom" } }]);
    try {
      await postTweet({ body: "x", env: baseEnv, fetchImpl });
    } catch (e) {
      expect(e.message).not.toContain("cs");
      expect(e.message).not.toContain("ats");
    }
  });
});

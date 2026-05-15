import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleTelegramUpdate } from "../functions/api/telegram-webhook.js";

function makeDb() {
  const posts = [];
  const db = {
    posts,
    get streamRows() { return posts.filter(p => p.is_stream === 1); },
    get tweetRows() { return posts.filter(p => p.is_tweet === 1); },
    prepare(sql) {
      const isStreamInsert = /is_stream,\s*is_tweet\)\s*VALUES\s*\(\?,\s*\?,\s*\?,\s*\?,\s*\?,\s*\?,\s*1,\s*\?\)/i.test(sql);
      const isTweetInsert = /is_stream,\s*is_tweet\)\s*VALUES\s*\(\?,\s*\?,\s*\?,\s*\?,\s*\?,\s*\?,\s*0,\s*1\)/i.test(sql);
      return {
        _sql: sql,
        _binds: [],
        bind(...args) { this._binds = args; return this; },
        async run() {
          if (/INSERT OR IGNORE INTO posts/i.test(this._sql)) {
            if (isStreamInsert) {
              const [chat_id, update_id, message_id, body, iso, ms, is_tweet] = this._binds;
              if (posts.find(p => p.telegram_update_id === update_id)) return { meta: { changes: 0 } };
              posts.push({ chat_id, telegram_update_id: update_id, telegram_message_id: message_id, body, iso, ms, is_stream: 1, is_tweet });
              return { meta: { changes: 1 } };
            }
            if (isTweetInsert) {
              const [chat_id, update_id, message_id, body, iso, ms] = this._binds;
              if (posts.find(p => p.telegram_update_id === update_id)) return { meta: { changes: 0 } };
              posts.push({ chat_id, telegram_update_id: update_id, telegram_message_id: message_id, body, iso, ms, is_stream: 0, is_tweet: 1 });
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }
          if (/UPDATE posts SET x_tweet_id/i.test(this._sql)) {
            const [x_id, update_id] = this._binds;
            const p = posts.find(p => p.telegram_update_id === update_id);
            if (p) p.x_tweet_id = x_id;
            return { meta: { changes: p ? 1 : 0 } };
          }
          return { meta: { changes: 0 } };
        },
        async first() { return null; },
      };
    },
  };
  return db;
}

function baseEnv(overrides = {}) {
  return {
    TELEGRAM_BOT_TOKEN: "tg-bot",
    TELEGRAM_ALLOWED_CHAT_ID: "111",
    X_CONSUMER_KEY: "ck",
    X_CONSUMER_SECRET: "cs",
    X_ACCESS_TOKEN: "at",
    X_ACCESS_TOKEN_SECRET: "ats",
    STREAM_DB: null,
    ...overrides,
  };
}

function streamUpdate(text, { update_id = 1001, message_id = 5001, reply_to } = {}) {
  return {
    update_id,
    message: {
      message_id,
      chat: { id: 111 },
      date: 1715000000,
      text,
      ...(reply_to ? { reply_to_message: reply_to } : {}),
    },
  };
}

describe("handleTelegramUpdate", () => {
  let sentTelegram;
  let xPostSpy;
  let deps;

  beforeEach(() => {
    sentTelegram = [];
    xPostSpy = vi.fn(async ({ body }) => ({ id: "9999", text: body }));
    deps = {
      sendTelegram: async (env, payload) => { sentTelegram.push(payload); },
      postTweet: xPostSpy,
    };
  });

  it("ignores updates from other chats", async () => {
    const db = makeDb();
    const update = streamUpdate("/t hi", { update_id: 1 });
    update.message.chat.id = 999;
    const res = await handleTelegramUpdate({ env: { ...baseEnv(), STREAM_DB: db }, update, deps });
    expect(res.ignored).toBe(true);
    expect(db.tweetRows).toHaveLength(0);
    expect(xPostSpy).not.toHaveBeenCalled();
  });

  it("ignores non-command messages", async () => {
    const db = makeDb();
    const res = await handleTelegramUpdate({ env: { ...baseEnv(), STREAM_DB: db }, update: streamUpdate("hello"), deps });
    expect(res.ignored).toBe(true);
  });

  it("preserves existing /stream behavior", async () => {
    const db = makeDb();
    const res = await handleTelegramUpdate({ env: { ...baseEnv(), STREAM_DB: db }, update: streamUpdate("/stream a thought"), deps });
    expect(res.published).toBe(true);
    expect(db.posts).toHaveLength(1);
    expect(db.posts[0].body).toBe("a thought");
    expect(db.posts[0].is_stream).toBe(1);
    expect(db.posts[0].is_tweet).toBe(0);
    expect(sentTelegram[0].text).toMatch(/^published\.?$/i);
    expect(xPostSpy).not.toHaveBeenCalled();
  });

  it("/stream /t streams AND tweets in one row", async () => {
    const db = makeDb();
    const res = await handleTelegramUpdate({
      env: { ...baseEnv(), STREAM_DB: db, X_HANDLE: "me" },
      update: streamUpdate("/stream /t shipping tonight"),
      deps,
    });
    expect(res.published).toBe(true);
    expect(res.tweeted).toBe(true);
    expect(db.posts).toHaveLength(1);
    expect(db.posts[0].is_stream).toBe(1);
    expect(db.posts[0].is_tweet).toBe(1);
    expect(db.posts[0].body).toBe("shipping tonight");
    expect(db.posts[0].x_tweet_id).toBe("9999");
    expect(xPostSpy.mock.calls[0][0].body).toBe("shipping tonight");
    expect(sentTelegram[0].text).toMatch(/published and posted.*x\.com\/me\/status\/9999/i);
  });

  it("/stream /t rejects over-length without writing anything", async () => {
    const db = makeDb();
    const long = "a".repeat(281);
    await handleTelegramUpdate({
      env: { ...baseEnv(), STREAM_DB: db },
      update: streamUpdate(`/stream /t ${long}`),
      deps,
    });
    expect(db.posts).toHaveLength(0);
    expect(xPostSpy).not.toHaveBeenCalled();
    expect(sentTelegram[0].text).toMatch(/too long/i);
  });

  it("/stream /t still streams if tweet fails (no x_tweet_id)", async () => {
    const db = makeDb();
    xPostSpy = vi.fn(async () => { throw new Error("duplicate content"); });
    deps.postTweet = xPostSpy;
    await handleTelegramUpdate({
      env: { ...baseEnv(), STREAM_DB: db },
      update: streamUpdate("/stream /t dup"),
      deps,
    });
    expect(db.posts).toHaveLength(1);
    expect(db.posts[0].is_stream).toBe(1);
    expect(db.posts[0].is_tweet).toBe(1);
    expect(db.posts[0].x_tweet_id).toBeUndefined();
    expect(sentTelegram[0].text).toMatch(/published, but tweet failed/i);
  });

  it("replies to /help without touching db", async () => {
    const db = makeDb();
    await handleTelegramUpdate({ env: { ...baseEnv(), STREAM_DB: db }, update: streamUpdate("/help"), deps });
    expect(sentTelegram[0].text).toMatch(/stream/i);
    expect(db.posts).toHaveLength(0);
  });

  it("posts to X on /t happy path with is_tweet=1, is_stream=0", async () => {
    const db = makeDb();
    const res = await handleTelegramUpdate({ env: { ...baseEnv(), STREAM_DB: db }, update: streamUpdate("/t shipping tonight"), deps });
    expect(res.tweeted).toBe(true);
    expect(res.published).toBeUndefined();
    expect(xPostSpy).toHaveBeenCalledOnce();
    expect(xPostSpy.mock.calls[0][0].body).toBe("shipping tonight");
    expect(db.posts).toHaveLength(1);
    expect(db.posts[0].is_stream).toBe(0);
    expect(db.posts[0].is_tweet).toBe(1);
    expect(db.posts[0].x_tweet_id).toBe("9999");
    expect(sentTelegram[0].text).toMatch(/x\.com\/.+\/status\/9999/);
  });

  it("/t with reply uses reply target text and strips /stream", async () => {
    const db = makeDb();
    const reply_to = { message_id: 4000, text: "/stream the actual thought" };
    await handleTelegramUpdate({
      env: { ...baseEnv(), STREAM_DB: db },
      update: streamUpdate("/t", { reply_to }),
      deps,
    });
    expect(xPostSpy.mock.calls[0][0].body).toBe("the actual thought");
  });

  it("/t inline payload wins over reply target", async () => {
    const db = makeDb();
    const reply_to = { message_id: 4000, text: "old thought" };
    await handleTelegramUpdate({
      env: { ...baseEnv(), STREAM_DB: db },
      update: streamUpdate("/t fresh take", { reply_to }),
      deps,
    });
    expect(xPostSpy.mock.calls[0][0].body).toBe("fresh take");
  });

  it("rejects /t with no body and no reply", async () => {
    const db = makeDb();
    await handleTelegramUpdate({ env: { ...baseEnv(), STREAM_DB: db }, update: streamUpdate("/t"), deps });
    expect(xPostSpy).not.toHaveBeenCalled();
    expect(sentTelegram[0].text).toMatch(/nothing/i);
    expect(db.tweetRows).toHaveLength(0);
  });

  it("rejects /t over 280 chars", async () => {
    const db = makeDb();
    const long = "a".repeat(281);
    await handleTelegramUpdate({ env: { ...baseEnv(), STREAM_DB: db }, update: streamUpdate(`/t ${long}`), deps });
    expect(xPostSpy).not.toHaveBeenCalled();
    expect(sentTelegram[0].text).toMatch(/too long/i);
    expect(db.tweetRows).toHaveLength(0);
  });

  it("dedupes duplicate update_id", async () => {
    const db = makeDb();
    const env = { ...baseEnv(), STREAM_DB: db };
    await handleTelegramUpdate({ env, update: streamUpdate("/t once", { update_id: 7 }), deps });
    await handleTelegramUpdate({ env, update: streamUpdate("/t once", { update_id: 7 }), deps });
    expect(xPostSpy).toHaveBeenCalledOnce();
    expect(db.tweetRows).toHaveLength(1);
  });

  it("/t reply uses caption when reply target has no text", async () => {
    const db = makeDb();
    const reply_to = { message_id: 4000, caption: "from a photo caption" };
    await handleTelegramUpdate({
      env: { ...baseEnv(), STREAM_DB: db },
      update: streamUpdate("/t", { reply_to }),
      deps,
    });
    expect(xPostSpy).toHaveBeenCalledOnce();
    expect(xPostSpy.mock.calls[0][0].body).toBe("from a photo caption");
  });

  it("/t reply rejects when reply target has neither text nor caption", async () => {
    const db = makeDb();
    const reply_to = { message_id: 4000 };
    await handleTelegramUpdate({
      env: { ...baseEnv(), STREAM_DB: db },
      update: streamUpdate("/t", { reply_to }),
      deps,
    });
    expect(xPostSpy).not.toHaveBeenCalled();
    expect(sentTelegram[0].text).toMatch(/nothing/i);
    expect(db.posts).toHaveLength(0);
  });

  it("/stream /t with no body rejects", async () => {
    const db = makeDb();
    await handleTelegramUpdate({
      env: { ...baseEnv(), STREAM_DB: db },
      update: streamUpdate("/stream /t"),
      deps,
    });
    expect(xPostSpy).not.toHaveBeenCalled();
    expect(db.posts).toHaveLength(0);
    expect(sentTelegram[0].text).toMatch(/nothing/i);
  });

  it("/stream with no payload rejects (preserves prior behavior)", async () => {
    const db = makeDb();
    await handleTelegramUpdate({
      env: { ...baseEnv(), STREAM_DB: db },
      update: streamUpdate("/stream"),
      deps,
    });
    expect(db.posts).toHaveLength(0);
    expect(sentTelegram[0].text).toMatch(/nothing/i);
  });

  it("/stream dedupes duplicate update_id", async () => {
    const db = makeDb();
    const env = { ...baseEnv(), STREAM_DB: db };
    await handleTelegramUpdate({ env, update: streamUpdate("/stream once", { update_id: 42 }), deps });
    await handleTelegramUpdate({ env, update: streamUpdate("/stream once", { update_id: 42 }), deps });
    expect(db.posts).toHaveLength(1);
  });

  it("/start command replies with help text", async () => {
    const db = makeDb();
    await handleTelegramUpdate({
      env: { ...baseEnv(), STREAM_DB: db },
      update: streamUpdate("/start"),
      deps,
    });
    expect(sentTelegram[0].text).toMatch(/stream/i);
    expect(sentTelegram[0].text).toMatch(/\/t/);
    expect(db.posts).toHaveLength(0);
  });

  it("/t leaves x_tweet_id NULL and replies with error on X error", async () => {
    const db = makeDb();
    xPostSpy = vi.fn(async () => { throw new Error("duplicate content"); });
    deps.postTweet = xPostSpy;
    await handleTelegramUpdate({ env: { ...baseEnv(), STREAM_DB: db }, update: streamUpdate("/t dup"), deps });
    expect(db.tweetRows[0].is_tweet).toBe(1);
    expect(db.tweetRows[0].x_tweet_id).toBeUndefined();
    expect(sentTelegram[0].text).toMatch(/failed|error/i);
  });
});

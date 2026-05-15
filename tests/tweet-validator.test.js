import { describe, it, expect } from "vitest";
import { validateTweet, weightedLength, MAX_TWEET_WEIGHT } from "../functions/lib/tweet-validator.js";

describe("weightedLength", () => {
  it("counts ASCII as 1 each", () => {
    expect(weightedLength("hello")).toBe(5);
  });

  it("counts emoji as 2", () => {
    expect(weightedLength("🚀")).toBe(2);
    expect(weightedLength("hi 🚀")).toBe(5);
  });

  it("counts CJK as 2 each", () => {
    expect(weightedLength("漢字")).toBe(4);
  });

  it("counts URLs as 23 regardless of length", () => {
    expect(weightedLength("see https://example.com/very/long/path?with=query")).toBe("see ".length + 23);
    expect(weightedLength("http://a.co")).toBe(23);
  });

  it("handles empty string", () => {
    expect(weightedLength("")).toBe(0);
  });
});

describe("validateTweet", () => {
  it("accepts a normal tweet", () => {
    const r = validateTweet("hello world");
    expect(r.ok).toBe(true);
    expect(r.body).toBe("hello world");
  });

  it("rejects empty body", () => {
    const r = validateTweet("");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/empty/i);
  });

  it("rejects whitespace-only body", () => {
    const r = validateTweet("   \n  ");
    expect(r.ok).toBe(false);
  });

  it(`rejects body over ${MAX_TWEET_WEIGHT} weighted chars`, () => {
    const body = "a".repeat(MAX_TWEET_WEIGHT + 1);
    const r = validateTweet(body);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/too long/i);
    expect(r.length).toBe(MAX_TWEET_WEIGHT + 1);
  });

  it(`accepts body at exactly ${MAX_TWEET_WEIGHT}`, () => {
    const r = validateTweet("a".repeat(MAX_TWEET_WEIGHT));
    expect(r.ok).toBe(true);
  });

  it("rejects null/undefined/non-string", () => {
    expect(validateTweet(null).ok).toBe(false);
    expect(validateTweet(undefined).ok).toBe(false);
    expect(validateTweet(123).ok).toBe(false);
  });
});

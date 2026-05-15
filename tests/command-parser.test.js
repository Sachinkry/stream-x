import { describe, it, expect } from "vitest";
import { parseCommand, resolveTweetBody, splitStreamTweetPayload } from "../functions/lib/command-parser.js";

describe("parseCommand", () => {
  it("parses /stream with payload", () => {
    expect(parseCommand("/stream hello world")).toEqual({
      command: "stream",
      payload: "hello world",
    });
  });

  it("parses /t with payload", () => {
    expect(parseCommand("/t shipping tonight")).toEqual({
      command: "t",
      payload: "shipping tonight",
    });
  });

  it("parses /t with no payload", () => {
    expect(parseCommand("/t")).toEqual({ command: "t", payload: "" });
  });

  it("lowercases command and strips bot username", () => {
    expect(parseCommand("/T@MyBot hi")).toEqual({ command: "t", payload: "hi" });
  });

  it("returns null for non-commands", () => {
    expect(parseCommand("hello")).toBeNull();
    expect(parseCommand("")).toBeNull();
    expect(parseCommand("  /t hi  ")).toEqual({ command: "t", payload: "hi" });
  });

  it("rejects commands with non-alphanumeric command names", () => {
    expect(parseCommand("/../etc/passwd")).toBeNull();
  });

  it("preserves payload whitespace and newlines", () => {
    expect(parseCommand("/t line one\nline two")).toEqual({
      command: "t",
      payload: "line one\nline two",
    });
  });
});

describe("splitStreamTweetPayload", () => {
  it("returns alsoTweet:false for plain text", () => {
    expect(splitStreamTweetPayload("just a thought")).toEqual({ body: "just a thought", alsoTweet: false });
  });

  it("detects leading /t and strips it", () => {
    expect(splitStreamTweetPayload("/t shipping tonight")).toEqual({ body: "shipping tonight", alsoTweet: true });
  });

  it("requires a space after /t (does not match /talented)", () => {
    expect(splitStreamTweetPayload("/talented engineers")).toEqual({ body: "/talented engineers", alsoTweet: false });
  });

  it("trims body after stripping /t", () => {
    expect(splitStreamTweetPayload("/t   padded  ")).toEqual({ body: "padded", alsoTweet: true });
  });

  it("rejects /t with no body after it", () => {
    expect(splitStreamTweetPayload("/t")).toEqual({ body: "", alsoTweet: true });
    expect(splitStreamTweetPayload("/t   ")).toEqual({ body: "", alsoTweet: true });
  });
});

describe("resolveTweetBody", () => {
  it("uses inline payload when present", () => {
    expect(resolveTweetBody({ payload: "inline text", replyText: "ignored" })).toBe("inline text");
  });

  it("falls back to reply target when payload empty", () => {
    expect(resolveTweetBody({ payload: "", replyText: "from reply" })).toBe("from reply");
  });

  it("strips leading /stream from reply target", () => {
    expect(resolveTweetBody({ payload: "", replyText: "/stream the actual thought" })).toBe("the actual thought");
  });

  it("strips /stream@Bot prefix from reply target", () => {
    expect(resolveTweetBody({ payload: "", replyText: "/stream@MyBot the actual thought" })).toBe("the actual thought");
  });

  it("does not strip /stream from inline payload", () => {
    expect(resolveTweetBody({ payload: "/stream literal", replyText: "" })).toBe("/stream literal");
  });

  it("returns empty string when nothing to tweet", () => {
    expect(resolveTweetBody({ payload: "", replyText: "" })).toBe("");
    expect(resolveTweetBody({ payload: "", replyText: null })).toBe("");
  });

  it("trims surrounding whitespace from result", () => {
    expect(resolveTweetBody({ payload: "  spaced  ", replyText: "" })).toBe("spaced");
    expect(resolveTweetBody({ payload: "", replyText: "  /stream   padded  " })).toBe("padded");
  });
});

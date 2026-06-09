import { describe, expect, it } from "vitest";
import { stripHtml } from "../src/ingest/html.js";

describe("stripHtml", () => {
  it("returns empty string for nullish input", () => {
    expect(stripHtml(null)).toBe("");
    expect(stripHtml(undefined)).toBe("");
    expect(stripHtml("")).toBe("");
  });

  it("removes tags and collapses whitespace", () => {
    expect(stripHtml("<p>Hello   <b>world</b></p>\n\n")).toBe("Hello world");
  });

  it("decodes non-tag named entities", () => {
    expect(stripHtml("Tom &amp; Jerry &quot;quoted&quot;")).toBe(
      'Tom & Jerry "quoted"',
    );
  });

  it("strips HTML that was entity-escaped in the feed (decode then strip)", () => {
    // Faithful to bus-finance order: entities decode first, so escaped markup
    // becomes real tags and is then stripped — the desired cleaning behavior.
    expect(stripHtml("&lt;p&gt;para&lt;/p&gt;")).toBe("para");
  });

  it("decodes numeric (decimal + hex) entities", () => {
    expect(stripHtml("em&#8212;dash")).toBe("em—dash");
    expect(stripHtml("hex&#x2014;dash")).toBe("hex—dash");
  });

  it("leaves unknown named entities untouched", () => {
    expect(stripHtml("keep &notareal; here")).toBe("keep &notareal; here");
  });
});

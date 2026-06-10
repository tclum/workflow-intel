import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseMessage, parseMessages } from "../src/ingest/email.js";

// Offline .eml fixtures — NO network / IMAP. Mirrors rss.test.ts's use of
// parseFeedString against sample-feed.xml.
function fixture(name: string): Buffer {
  return readFileSync(
    fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
  );
}

describe("parseMessage (offline .eml fixtures — no network)", () => {
  it("plain-text: Message-ID as externalId, text as summary, mid: url fallback", async () => {
    const n = await parseMessage(fixture("email-plain-text.eml"));
    expect(n).not.toBeNull();
    expect(n?.externalId).toBe("<plain-001@anthropic.com>");
    expect(n?.title).toBe("Claude gets a context window upgrade");
    expect(n?.author).toContain("newsletter@anthropic.com");
    expect(n?.summary).toContain("Token-efficiency");
    // No clean permalink (no List-Post http) → synthetic mid:<externalId>.
    expect(n?.url).toBe("mid:<plain-001@anthropic.com>");
    expect(n?.publishedAt).toBeInstanceOf(Date);
  });

  it("html-only: strips tags + entities for summary, keeps raw html as rawContent", async () => {
    const n = await parseMessage(fixture("email-html-only.eml"));
    expect(n?.externalId).toBe("<html-001@deeplearning.ai>");
    // Subject entity is decoded by stripHtml.
    expect(n?.title).toBe("This week in AI & deep learning");
    const summary = n?.summary ?? "";
    expect(summary).toContain("smaller & faster");
    expect(summary).not.toMatch(/<[^>]+>/); // tags stripped
    expect(summary).not.toContain("&amp;"); // entity decoded
    expect(n?.rawContent ?? "").toContain("smaller"); // raw html retained
  });

  it("multipart: prefers the text/plain part and uses the List-Post permalink", async () => {
    const n = await parseMessage(fixture("email-multipart.eml"));
    expect(n?.externalId).toBe("<multipart-001@importai.net>");
    expect(n?.summary ?? "").toContain("PLAINTEXT PART");
    expect(n?.summary ?? "").not.toContain("HTML PART"); // text preferred over html
    // Clean http permalink present in List-Post → used verbatim (not mid:).
    expect(n?.url).toBe("https://importai.substack.com/p/import-ai-400");
  });

  it("missing Message-ID: falls back to a stable sha256 externalId + mid: url", async () => {
    const n = await parseMessage(fixture("email-no-message-id.eml"));
    expect(n?.externalId).toMatch(/^sha256:[0-9a-f]{64}$/);
    // url is built from the derived externalId, so it stays non-null and stable.
    expect(n?.url).toBe(`mid:${n?.externalId}`);
  });

  it("missing Message-ID is deterministic across re-parses (dedup-safe)", async () => {
    const raw = fixture("email-no-message-id.eml");
    const a = await parseMessage(raw);
    const b = await parseMessage(raw);
    expect(a?.externalId).toBe(b?.externalId);
  });

  it("skips a message with no derivable stable id (no Message-ID, no from/subject/date)", async () => {
    // A bare body with no headers → mailparser yields no from/subject/date/id.
    const n = await parseMessage("\n\njust a body, no headers at all\n");
    expect(n).toBeNull();
  });
});

describe("parseMessages (batch)", () => {
  it("normalizes all valid fixtures and drops the id-less one", async () => {
    const raws = [
      fixture("email-plain-text.eml"),
      fixture("email-html-only.eml"),
      fixture("email-multipart.eml"),
      fixture("email-no-message-id.eml"),
      Buffer.from("\n\nno headers here\n"), // dropped: no stable id
    ];
    const out = await parseMessages(raws);
    expect(out).toHaveLength(4);
    expect(out.map((n) => n.externalId)).toContain("<plain-001@anthropic.com>");
  });
});

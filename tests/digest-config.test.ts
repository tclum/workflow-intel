import { describe, expect, it } from "vitest";
import { env } from "../src/config/env.js";
import {
  isDigestEnabled,
  resolveDigestRecipients,
} from "../src/digest/config.js";

describe("resolveDigestRecipients", () => {
  it("returns the DB rows when present", async () => {
    const to = await resolveDigestRecipients(async () => [
      "a@example.com",
      "b@example.com",
    ]);
    expect(to).toEqual(["a@example.com", "b@example.com"]);
  });

  it("falls back to env DIGEST_RECIPIENTS when the table is empty", async () => {
    const to = await resolveDigestRecipients(async () => []);
    expect(to).toEqual(env.DIGEST_RECIPIENTS);
  });

  it("falls back to env DIGEST_RECIPIENTS when the DB read throws", async () => {
    const to = await resolveDigestRecipients(async () => {
      throw new Error("connection refused");
    });
    expect(to).toEqual(env.DIGEST_RECIPIENTS);
  });
});

describe("isDigestEnabled", () => {
  it("pauses only when the flag reads an explicit false", async () => {
    expect(await isDigestEnabled(async () => false)).toBe(false);
  });

  it("is enabled when the flag is true", async () => {
    expect(await isDigestEnabled(async () => true)).toBe(true);
  });

  it("fails open (enabled) when no settings row exists", async () => {
    expect(await isDigestEnabled(async () => null)).toBe(true);
  });

  it("fails open (enabled) when the settings read throws", async () => {
    expect(
      await isDigestEnabled(async () => {
        throw new Error("connection refused");
      }),
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { sendEmail } from "../src/digest/resend.js";

function okFetch(calls: unknown[]): typeof fetch {
  return (async (
    url: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ id: "email_123" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

describe("sendEmail", () => {
  it("posts to Resend with auth, recipients, html, and text", async () => {
    const calls: unknown[] = [];
    const result = await sendEmail({
      apiKey: "rk_test",
      from: "intel@forpono.com",
      to: ["tclum@hawaii.edu"],
      subject: "Subject",
      html: "<p>Hello</p>",
      text: "Hello",
      fetchImpl: okFetch(calls),
    });

    expect(result.id).toBe("email_123");
    expect(calls).toHaveLength(1);
    const call = calls[0] as { url: string; init: RequestInit };
    expect(call.url).toBe("https://api.resend.com/emails");
    expect(call.init.method).toBe("POST");
    expect(call.init.headers).toEqual(
      expect.objectContaining({
        authorization: "Bearer rk_test",
        "content-type": "application/json",
      }),
    );
    expect(JSON.parse(String(call.init.body))).toEqual({
      from: "intel@forpono.com",
      to: ["tclum@hawaii.edu"],
      subject: "Subject",
      html: "<p>Hello</p>",
      text: "Hello",
    });
  });

  it("throws on non-2xx responses", async () => {
    const fetchImpl = (async () =>
      new Response("bad key", { status: 401, statusText: "Unauthorized" })) as typeof fetch;

    await expect(
      sendEmail({
        apiKey: "rk_bad",
        from: "intel@forpono.com",
        to: ["tclum@hawaii.edu"],
        subject: "Subject",
        html: "<p>Hello</p>",
        fetchImpl,
      }),
    ).rejects.toThrow(/Resend API 401/);
  });

  it("rejects an empty recipient list before fetch", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    await expect(
      sendEmail({
        apiKey: "rk_test",
        from: "intel@forpono.com",
        to: [],
        subject: "Subject",
        html: "<p>Hello</p>",
        fetchImpl,
      }),
    ).rejects.toThrow(/at least one recipient/);
    expect(called).toBe(false);
  });
});

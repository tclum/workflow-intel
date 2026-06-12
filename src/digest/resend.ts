const RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails";

export interface SendEmailInput {
  apiKey: string;
  from: string;
  to: readonly string[];
  subject: string;
  html: string;
  text?: string;
  fetchImpl?: typeof fetch;
}

export interface SendEmailResult {
  id: string | null;
}

interface ResendResponse {
  id?: string;
}

export async function sendEmail({
  apiKey,
  from,
  to,
  subject,
  html,
  text,
  fetchImpl,
}: SendEmailInput): Promise<SendEmailResult> {
  if (to.length === 0) {
    throw new Error("Resend email requires at least one recipient");
  }

  const doFetch = fetchImpl ?? fetch;
  const res = await doFetch(RESEND_EMAILS_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
      ...(text ? { text } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Resend API ${res.status} ${res.statusText}: ${body.slice(0, 500)}`,
    );
  }

  const json = (await res.json().catch(() => ({}))) as ResendResponse;
  return { id: json.id ?? null };
}

import { env } from "../config/env.js";
import { db } from "../db/client.js";
import { digestRecipients, settings } from "../db/schema.js";

// DB-backed digest config (settings + digest_recipients, migration 0005). Both
// resolvers FAIL OPEN: a DB blip must never silently drop the weekly send. The
// real DB reads are thin seams injected in tests, so the fallback logic is
// unit-tested without a live database (mirrors resend.ts's fetchImpl pattern).

async function loadRecipientEmails(): Promise<string[]> {
  const rows = await db
    .select({ email: digestRecipients.email })
    .from(digestRecipients)
    .orderBy(digestRecipients.createdAt);
  return rows.map((row) => row.email);
}

// Recipient list: the DB rows if any, else env.DIGEST_RECIPIENTS. An empty
// table OR a thrown read both fall back to env.
export async function resolveDigestRecipients(
  loadEmails: () => Promise<string[]> = loadRecipientEmails,
): Promise<string[]> {
  try {
    const emails = (await loadEmails()).filter((email) => email.length > 0);
    if (emails.length > 0) return emails;
  } catch (err) {
    console.warn(
      `[digest] recipient DB read failed; falling back to env DIGEST_RECIPIENTS: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  return env.DIGEST_RECIPIENTS;
}

// Returns null when no settings row exists (0005 seeds one, so this is an edge).
async function loadDigestEnabled(): Promise<boolean | null> {
  const rows = await db
    .select({ digestEnabled: settings.digestEnabled })
    .from(settings)
    .limit(1);
  return rows[0]?.digestEnabled ?? null;
}

// Pause check: only an explicit `false` (read successfully) pauses the digest.
// No row or a thrown read → enabled, consistent with the recipients fallback.
export async function isDigestEnabled(
  loadEnabled: () => Promise<boolean | null> = loadDigestEnabled,
): Promise<boolean> {
  try {
    return (await loadEnabled()) !== false;
  } catch (err) {
    console.warn(
      `[digest] settings read failed; proceeding (fail-open): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return true;
  }
}

import { config as loadDotenv } from "dotenv";
import { z } from "zod";

// Pattern mirrors flyer-bot/src/config.ts: load dotenv, validate process.env
// against a Zod schema, fail loud (exit 1) on invalid env. Importing this module
// runs validation as a side effect — entrypoints (migrate, ingest) import it;
// pure/unit-tested modules deliberately do NOT, so tests never trigger exit.
loadDotenv();

const envSchema = z.object({
  // Required now (Slice 0): Postgres connection for migrations + queries.
  DATABASE_URL: z.string().min(1),

  NODE_ENV: z.string().default("development"),
  LOG_LEVEL: z.string().default("info"),

  // Slice 1.5 (email-newsletter ingestion) — IMAP poll of a dedicated Gmail.
  // Optional like the other reserved keys so migrate / RSS-only ingest / tests
  // never require them; the email fetcher asserts USER/PASSWORD at fetch time.
  IMAP_HOST: z.string().default("imap.gmail.com"),
  IMAP_USER: z.string().min(1).optional(),
  IMAP_PASSWORD: z.string().min(1).optional(),

  // Reserved for Slice 2 (semantic dedup) — embeddings via Voyage. Unused now.
  VOYAGE_API_KEY: z.string().min(1).optional(),
  VOYAGE_MODEL: z.string().default("voyage-3"),

  // Reserved for Slice 3 (triage) + Slice 4 (synthesis) — Anthropic. Unused now.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_TRIAGE_MODEL: z.string().default("claude-haiku-4-5"),
  ANTHROPIC_SYNTHESIS_MODEL: z.string().default("claude-opus-4-8"),
});

export type Env = z.infer<typeof envSchema>;

function failStartup(msg: string, detail: unknown): never {
  console.error(`[workflow-intel] ${msg}`);
  console.error(JSON.stringify(detail, null, 2));
  process.exit(1);
}

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    failStartup("invalid environment variables", parsed.error.format());
  }
  return parsed.data;
}

export const env: Env = loadEnv();

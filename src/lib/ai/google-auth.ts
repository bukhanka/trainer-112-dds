/**
 * OAuth access token for Google Cloud from a service-account key (JWT bearer grant), cached until
 * shortly before it expires. Used when the model endpoints are Google Cloud (Vertex AI OpenAI-compatible
 * chat, Speech-to-Text, Text-to-Speech).
 *
 * The key comes from GOOGLE_APPLICATION_CREDENTIALS (path to the JSON file) or GOOGLE_CREDENTIALS_JSON
 * (the JSON itself, handy for container secrets). It never leaves the server.
 */
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string; project_id?: string };

const SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";

let account: ServiceAccount | null = null;
let cached: { token: string; expiresAt: number } | null = null;
let inflight: Promise<string> | null = null;

let configured: boolean | null = null;

export function googleCredentialsConfigured(): boolean {
  if (configured !== null) return configured;
  if (process.env.GOOGLE_CREDENTIALS_JSON) return (configured = true);
  const file = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!file) return (configured = false);
  try {
    // The container mounts an empty placeholder when no key is given.
    configured = Boolean((JSON.parse(readFileSync(/*turbopackIgnore: true*/ file, "utf8")) as ServiceAccount).client_email);
  } catch {
    configured = false;
  }
  return configured;
}

function serviceAccount(): ServiceAccount {
  if (account) return account;
  const raw = process.env.GOOGLE_CREDENTIALS_JSON ?? readFileSync(/*turbopackIgnore: true*/ process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "", "utf8");
  const parsed = JSON.parse(raw) as ServiceAccount;
  if (!parsed.client_email || !parsed.private_key) throw new Error("Google credentials: not a service-account key");
  account = parsed;
  return parsed;
}

/** Project of the service account; GOOGLE_CLOUD_PROJECT overrides it. */
export function googleProject(): string {
  return process.env.GOOGLE_CLOUD_PROJECT || serviceAccount().project_id || "";
}

/** Signed JWT assertion for the token endpoint (exported for tests). */
export function signedAssertion(sa: ServiceAccount, nowSec = Math.floor(Date.now() / 1000)): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: sa.client_email,
    scope: SCOPE,
    aud: sa.token_uri ?? DEFAULT_TOKEN_URI,
    iat: nowSec,
    exp: nowSec + 3600,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  return `${unsigned}.${signature}`;
}

async function fetchToken(): Promise<string> {
  const sa = serviceAccount();
  const res = await fetch(sa.token_uri ?? DEFAULT_TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signedAssertion(sa) }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !data.access_token) throw new Error(`Google token: ${res.status} ${data.error ?? ""}`.trim());
  cached = { token: data.access_token, expiresAt: Date.now() + ((data.expires_in ?? 3600) - 120) * 1000 };
  return data.access_token;
}

/** A valid access token; concurrent callers share one refresh. */
export async function googleAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  inflight ??= fetchToken().finally(() => {
    inflight = null;
  });
  return inflight;
}

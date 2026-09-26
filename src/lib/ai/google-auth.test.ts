import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signedAssertion } from "./google-auth";

describe("Google service-account assertion", () => {
  it("is a JWT signed with the account key for the token endpoint", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const sa = {
      client_email: "trainer@example.iam.gserviceaccount.com",
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      token_uri: "https://oauth2.googleapis.com/token",
    };
    const jwt = signedAssertion(sa, 1_800_000_000);
    const [header, payload, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    expect(claims).toMatchObject({ iss: sa.client_email, aud: sa.token_uri, iat: 1_800_000_000, exp: 1_800_003_600 });
    expect(claims.scope).toContain("cloud-platform");
    const ok = createVerify("RSA-SHA256").update(`${header}.${payload}`).verify(publicKey, Buffer.from(signature, "base64url"));
    expect(ok).toBe(true);
  });
});

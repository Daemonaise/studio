import { SignJWT, importPKCS8 } from "jose";

let cachedSecret: { token: string; expiresAt: number } | null = null;

/**
 * Generates an Apple client secret JWT (ES256).
 * Caches the token and regenerates when within 5 minutes of expiry.
 * Apple client secrets are valid for up to 6 months.
 */
export async function getAppleClientSecret(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  if (cachedSecret && cachedSecret.expiresAt - now > 300) {
    return cachedSecret.token;
  }

  const teamId = process.env.APPLE_TEAM_ID!;
  const keyId = process.env.APPLE_KEY_ID!;
  const clientId = process.env.APPLE_CLIENT_ID!;
  const privateKeyPem = process.env.APPLE_PRIVATE_KEY!.replace(/\\n/g, "\n");

  const privateKey = await importPKCS8(privateKeyPem, "ES256");

  const expiresAt = now + 15777000; // ~6 months

  const token = await new SignJWT({})
    .setAudience("https://appleid.apple.com")
    .setIssuer(teamId)
    .setSubject(clientId)
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .sign(privateKey);

  cachedSecret = { token, expiresAt };
  return token;
}

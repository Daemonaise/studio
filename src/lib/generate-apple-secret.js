#!/usr/bin/env node
/**
 * Regenerate the Apple client secret JWT.
 * Run: node src/lib/generate-apple-secret.js
 * Then paste the output into APPLE_CLIENT_SECRET in .env
 * The secret is valid for ~6 months.
 */
const { SignJWT, importPKCS8 } = require("jose");
require("dotenv").config();

(async () => {
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const clientId = process.env.APPLE_CLIENT_ID;
  const privateKeyPem = process.env.APPLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!teamId || !keyId || !clientId || !privateKeyPem) {
    console.error("Missing env vars: APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_CLIENT_ID, APPLE_PRIVATE_KEY");
    process.exit(1);
  }

  const now = Math.floor(Date.now() / 1000);
  const privateKey = await importPKCS8(privateKeyPem, "ES256");
  const token = await new SignJWT({})
    .setAudience("https://appleid.apple.com")
    .setIssuer(teamId)
    .setSubject(clientId)
    .setIssuedAt(now)
    .setExpirationTime(now + 15777000) // ~6 months
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .sign(privateKey);

  console.log("\nNew APPLE_CLIENT_SECRET (valid ~6 months):\n");
  console.log(token);
  console.log("\nExpires:", new Date((now + 15777000) * 1000).toISOString(), "\n");
})();

import { SignJWT, jwtVerify } from "jose";

const COOKIE = "yt-ctl-session";

export function cookieName() {
  return COOKIE;
}

function getSecretBytes(): Uint8Array | null {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) return null;
  return new TextEncoder().encode(s);
}

export async function createSessionToken(): Promise<string> {
  const secret = getSecretBytes();
  if (!secret) {
    throw new Error("SESSION_SECRET must be set (min 16 chars)");
  }
  return new SignJWT({ role: "controller" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

export async function verifySessionToken(token: string): Promise<boolean> {
  const secret = getSecretBytes();
  if (!secret) return false;
  try {
    await jwtVerify(token, secret);
    return true;
  } catch {
    return false;
  }
}

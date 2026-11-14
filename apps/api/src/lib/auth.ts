import { constantTimeEqual, hmacSha256Hex } from '@agrivoice/core';

const enc = new TextEncoder();
export const PBKDF2_ITERATIONS = 600_000;
export const SESSION_HOURS = 8;
export const COOKIE_NAME = 'av_admin';

function b64(buf: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf instanceof Uint8Array ? buf : new Uint8Array(buf))));
}
function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256);
}

/** Format: pbkdf2-sha256$<iterations>$<salt b64>$<hash b64> */
export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${iterations}$${b64(salt)}$${b64(await derive(password, salt, iterations))}`;
}

export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  if (!stored) return false;
  const [alg, it, salt, hash] = stored.split('$');
  const iterations = Number(it);
  if (alg !== 'pbkdf2-sha256' || !Number.isInteger(iterations) || iterations < 1 || !salt || !hash) return false;
  const got = b64(await derive(password, unb64(salt), iterations));
  return constantTimeEqual(got, hash);
}

export async function signSession(secret: string, now: Date): Promise<string> {
  const exp = now.getTime() + SESSION_HOURS * 3600_000;
  const payload = `admin.${exp}`;
  return `${payload}.${await hmacSha256Hex(secret, payload)}`;
}

export async function verifySession(secret: string | undefined, token: string | undefined, now: Date): Promise<boolean> {
  if (!secret || !token) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'admin') return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp <= now.getTime()) return false;
  return constantTimeEqual(await hmacSha256Hex(secret, `${parts[0]}.${parts[1]}`), parts[2]!);
}

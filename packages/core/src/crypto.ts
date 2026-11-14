const enc = new TextEncoder();

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

/** HMAC-SHA-256 of the phone number with the server secret. Digits only, so formatting does not matter. */
export async function hashPhone(phone: string, secret: string): Promise<string> {
  return hmacSha256Hex(secret, phone.replace(/[^\d]/g, ''));
}

/** SHA-256(code + pepper) for reporter codes. Codes are case-insensitive. */
export async function hashReporterCode(code: string, pepper: string): Promise<string> {
  return sha256Hex(code.trim().toUpperCase() + pepper);
}

export function constantTimeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Mask all but the last 2 digits for log lines. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.length <= 2) return '*'.repeat(digits.length);
  return '*'.repeat(digits.length - 2) + digits.slice(-2);
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1

export function generateReporterCode(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

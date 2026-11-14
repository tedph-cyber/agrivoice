// Africa's Talking USSD adapter. Isolated here so format changes stay in one file.
// Callback: application/x-www-form-urlencoded with sessionId, serviceCode, phoneNumber, text, networkCode.
// Reply: text/plain starting "CON " (continue) or "END " (finish).
import { z } from 'zod';
import { ApiError } from '../lib/util';

const schema = z.object({
  sessionId: z.string().min(1).max(100),
  phoneNumber: z.string().regex(/^\+?\d{6,16}$/),
  text: z.string().max(400).default(''),
  serviceCode: z.string().max(30).optional(),
  networkCode: z.string().max(20).optional(),
});

export function parseAtForm(form: Record<string, string>): { sessionId: string; phone: string; text: string } {
  const r = schema.safeParse(form);
  if (!r.success) throw new ApiError(400, 'validation_error', 'Invalid USSD request');
  return { sessionId: r.data.sessionId, phone: r.data.phoneNumber, text: r.data.text };
}

export function formatAtReply(out: { text: string }): string {
  return out.text; // engine output already carries the CON/END prefix
}

/** Retention rules (BUILD_SPEC section 12). `events` are aggregate-only and kept. */
export async function purge(db: D1Database, now = new Date()): Promise<Record<string, number>> {
  const day = new Date(now.getTime() - 86400_000).toISOString();
  const d30 = new Date(now.getTime() - 30 * 86400_000).toISOString();
  const r1 = await db.prepare('DELETE FROM ussd_sessions WHERE updated_at < ?').bind(day).run();
  const r2 = await db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(day).run();
  const r3 = await db.prepare('UPDATE questions SET contact = NULL WHERE contact IS NOT NULL AND created_at < ?').bind(d30).run();
  return { ussd_sessions: r1.meta.changes, rate_limits: r2.meta.changes, question_contacts: r3.meta.changes };
}

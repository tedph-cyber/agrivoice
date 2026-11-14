// Minimal D1Database implementation over node:sqlite, used for tests and the local dev server.
import { DatabaseSync } from 'node:sqlite';

type Param = string | number | null | bigint | Uint8Array;

function norm(args: unknown[]): Param[] {
  return args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : (a as Param)));
}

class Stmt {
  constructor(
    private db: DatabaseSync,
    readonly sql: string,
    private params: Param[] = [],
  ) {}
  bind(...args: unknown[]) {
    return new Stmt(this.db, this.sql, norm(args));
  }
  private meta(r: { changes: number | bigint; lastInsertRowid: number | bigint }) {
    return { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid), duration: 0, rows_read: 0, rows_written: 0 };
  }
  async first<T = Record<string, unknown>>(col?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (col ? row[col] : { ...row }) as T;
  }
  async all<T = Record<string, unknown>>() {
    const results = this.db.prepare(this.sql).all(...this.params).map((r) => ({ ...r })) as T[];
    return { results, success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } };
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.params);
    return { results: [], success: true, meta: this.meta(r) };
  }
  async raw() {
    const s = this.db.prepare(this.sql);
    s.setReturnArrays(true);
    return s.all(...this.params);
  }
}

export class D1Shim {
  readonly sqlite: DatabaseSync;
  constructor(path = ':memory:') {
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec('PRAGMA foreign_keys = ON;');
  }
  prepare(sql: string) {
    return new Stmt(this.sqlite, sql);
  }
  async exec(sql: string) {
    this.sqlite.exec(sql);
    return { count: 1, duration: 0 };
  }
  /** Atomic: all statements succeed or none are applied. */
  async batch(stmts: Stmt[]) {
    const out = [];
    this.sqlite.exec('BEGIN');
    try {
      for (const s of stmts) out.push(await s.run());
      this.sqlite.exec('COMMIT');
    } catch (e) {
      this.sqlite.exec('ROLLBACK');
      throw e;
    }
    return out;
  }
  close() {
    this.sqlite.close();
  }
}

export function asD1(db: D1Shim): D1Database {
  return db as unknown as D1Database;
}

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface SpoolRow {
  id: number;
  payload: string;
  attempts: number;
  created_at: number;
}

/**
 * Durable local queue between webhook receipt and successful forwarding to
 * `ingest-message`, plus the sent-message ledger used for self-message
 * detection in local-dev (the bot shares the developer's identity).
 */
export class Spool {
  private readonly db: Database.Database;

  constructor(path: string) {
    const full = resolve(path);
    mkdirSync(dirname(full), { recursive: true });
    this.db = new Database(full);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      create table if not exists spool (
        id integer primary key autoincrement,
        payload text not null,
        attempts integer not null default 0,
        delivered_at integer,
        created_at integer not null
      );
      create index if not exists spool_pending_idx on spool (delivered_at, id);

      create table if not exists sent_ledger (
        guid text primary key,
        chat_guid text not null,
        sent_at integer not null
      );

      create table if not exists kv (
        key text primary key,
        value text not null
      );
    `);
  }

  /** Watch cursor: max message rowid already processed from the imsg stream. */
  getWatchCursor(): number | null {
    const row = this.db.prepare("select value from kv where key = 'watch_cursor'").get() as
      | { value: string }
      | undefined;
    return row ? Number(row.value) : null;
  }

  setWatchCursor(rowid: number): void {
    this.db
      .prepare("insert into kv (key, value) values ('watch_cursor', ?) on conflict (key) do update set value = excluded.value")
      .run(String(rowid));
  }

  enqueue(payload: unknown): number {
    const info = this.db
      .prepare("insert into spool (payload, created_at) values (?, ?)")
      .run(JSON.stringify(payload), Date.now());
    return Number(info.lastInsertRowid);
  }

  nextPending(): SpoolRow | undefined {
    return this.db
      .prepare(
        "select id, payload, attempts, created_at from spool where delivered_at is null order by id limit 1",
      )
      .get() as SpoolRow | undefined;
  }

  markDelivered(id: number): void {
    this.db.prepare("update spool set delivered_at = ? where id = ?").run(Date.now(), id);
  }

  bumpAttempts(id: number): void {
    this.db.prepare("update spool set attempts = attempts + 1 where id = ?").run(id);
  }

  recordSent(guid: string, chatGuid: string): void {
    this.db
      .prepare("insert or ignore into sent_ledger (guid, chat_guid, sent_at) values (?, ?, ?)")
      .run(guid, chatGuid, Date.now());
  }

  wasSentByUs(guid: string): boolean {
    return (
      this.db.prepare("select 1 from sent_ledger where guid = ?").get(guid) !== undefined
    );
  }

  /** Delivered spool rows are deleted 7 days after delivery; ledger after 7 days too. */
  cleanup(): void {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    this.db.prepare("delete from spool where delivered_at is not null and delivered_at < ?").run(cutoff);
    this.db.prepare("delete from sent_ledger where sent_at < ?").run(cutoff);
  }
}

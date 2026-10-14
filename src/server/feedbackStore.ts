import { randomInt } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  MAX_FEEDBACK_RESPONSES,
  parseAnswers,
  parseDefinition,
  type Answers,
  type FeedbackAdminView,
  type FeedbackDefinition,
  type FeedbackResponse,
  type FeedbackVersion,
  type OwnResponse,
  type PublicFeedback,
} from '../shared/feedback.js';
import { SESSION_ID_LENGTH } from '../shared/protocol.js';
import { hashPassword, verifyPassword } from './password.js';

const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type FeedbackSubmitResult =
  | { ok: true; updated: boolean }
  | { ok: false; reason: 'not-found' | 'closed' | 'outdated' | 'full' | 'invalid'; errors?: string[] };

export type FeedbackUpdateResult =
  | { ok: true; feedback: PublicFeedback }
  | { ok: false; reason: 'unauthorized' }
  | { ok: false; reason: 'invalid'; errors: string[] };

interface FeedbackRow {
  id: string;
  password_hash: string;
  created_at: number;
  closed: number;
  version: number;
  definition: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS feedbacks (
  id              TEXT PRIMARY KEY,
  password_hash   TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  closed          INTEGER NOT NULL DEFAULT 0,
  current_version INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS feedback_versions (
  feedback_id TEXT NOT NULL REFERENCES feedbacks(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  definition  TEXT NOT NULL,
  PRIMARY KEY (feedback_id, version)
) STRICT;

CREATE TABLE IF NOT EXISTS responses (
  feedback_id  TEXT NOT NULL REFERENCES feedbacks(id) ON DELETE CASCADE,
  response_id  TEXT NOT NULL,
  version      INTEGER NOT NULL,
  submitted_at INTEGER NOT NULL,
  updated_at   INTEGER,
  answers      TEXT NOT NULL,
  PRIMARY KEY (feedback_id, response_id)
) STRICT;

CREATE INDEX IF NOT EXISTS responses_by_time ON responses (feedback_id, submitted_at);
`;

const SELECT_FEEDBACK = `
  SELECT f.id, f.password_hash, f.created_at, f.closed, f.current_version AS version, v.definition
  FROM feedbacks f
  JOIN feedback_versions v ON v.feedback_id = f.id AND v.version = f.current_version
  WHERE f.id = ?`;

/**
 * Persistente Feedback-Bögen in SQLite (WAL-Modus).
 * Jede Änderung der Fragen erzeugt eine neue Version; Antworten merken sich ihre Version.
 * Pro Gerät (responseId) gibt es höchstens eine Antwort je Bogen, die geändert werden kann.
 * `path` ist eine Datei oder ':memory:' (Tests).
 */
export class FeedbackStore {
  private readonly db: DatabaseSync;

  constructor(
    path: string,
    private readonly maxResponses = MAX_FEEDBACK_RESPONSES,
    private readonly now: () => number = Date.now,
  ) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;
    `);
    this.db.exec(SCHEMA);
  }

  get size(): number {
    return (this.db.prepare('SELECT count(*) AS n FROM feedbacks').get() as { n: number }).n;
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  async create(definition: FeedbackDefinition, password: string): Promise<PublicFeedback> {
    const passwordHash = await hashPassword(password);
    const now = this.now();
    for (let attempt = 0; attempt < 20; attempt++) {
      const id = generateId();
      const inserted = this.transaction(() => {
        const { changes } = this.db
          .prepare('INSERT OR IGNORE INTO feedbacks (id, password_hash, created_at, current_version) VALUES (?, ?, ?, 1)')
          .run(id, passwordHash, now);
        if (Number(changes) !== 1) return false;
        this.db
          .prepare('INSERT INTO feedback_versions (feedback_id, version, created_at, definition) VALUES (?, 1, ?, ?)')
          .run(id, now, JSON.stringify(definition));
        return true;
      });
      if (inserted) return { id, version: 1, definition, closed: false };
    }
    throw new Error('Konnte keine freie Feedback-ID erzeugen.');
  }

  getPublic(id: string): PublicFeedback | undefined {
    const row = this.row(id);
    return row ? toPublic(row) : undefined;
  }

  async getAdminView(id: string, password: string): Promise<FeedbackAdminView | undefined> {
    const row = await this.authorize(id, password);
    if (!row) return undefined;
    const versions = this.db
      .prepare('SELECT version, created_at, definition FROM feedback_versions WHERE feedback_id = ? ORDER BY version')
      .all(id)
      .map(
        (v): FeedbackVersion => ({
          version: v.version as number,
          createdAt: v.created_at as number,
          definition: JSON.parse(v.definition as string) as FeedbackDefinition,
        }),
      );
    const responses = this.db
      .prepare(
        'SELECT version, submitted_at, updated_at, answers FROM responses WHERE feedback_id = ? ORDER BY submitted_at, rowid',
      )
      .all(id)
      .map(
        (r): FeedbackResponse => ({
          submittedAt: r.submitted_at as number,
          ...(r.updated_at !== null ? { updatedAt: r.updated_at as number } : {}),
          version: r.version as number,
          answers: JSON.parse(r.answers as string) as Answers,
        }),
      );
    return { ...toPublic(row), createdAt: row.created_at, versions, responses };
  }

  /**
   * Speichert geänderte Fragen als neue Version (unverändert -> keine neue Version).
   * Neue Fragen ohne ID bekommen nie die ID einer früher gelöschten Frage.
   */
  async update(id: string, password: string, rawDefinition: unknown): Promise<FeedbackUpdateResult> {
    const row = await this.authorize(id, password);
    if (!row) return { ok: false, reason: 'unauthorized' };

    const usedIds = new Set<string>();
    for (const v of this.db.prepare('SELECT definition FROM feedback_versions WHERE feedback_id = ?').all(id)) {
      for (const q of (JSON.parse(v.definition as string) as FeedbackDefinition).questions) usedIds.add(q.id);
    }
    const parsed = parseDefinition(rawDefinition, usedIds);
    if (!parsed.ok) return { ok: false, reason: 'invalid', errors: parsed.errors };

    const definition = parsed.value;
    const json = JSON.stringify(definition);
    const version = this.transaction(() => {
      const current = this.row(id);
      if (!current) return undefined;
      if (current.definition === json) return current.version;
      const next = current.version + 1;
      this.db
        .prepare('INSERT INTO feedback_versions (feedback_id, version, created_at, definition) VALUES (?, ?, ?, ?)')
        .run(id, next, this.now(), json);
      this.db.prepare('UPDATE feedbacks SET current_version = ? WHERE id = ?').run(next, id);
      return next;
    });
    if (version === undefined) return { ok: false, reason: 'unauthorized' };
    return { ok: true, feedback: { id, version, definition, closed: row.closed === 1 } };
  }

  async setClosed(id: string, password: string, closed: boolean): Promise<boolean> {
    if (!(await this.authorize(id, password))) return false;
    const { changes } = this.db.prepare('UPDATE feedbacks SET closed = ? WHERE id = ?').run(closed ? 1 : 0, id);
    return Number(changes) === 1;
  }

  async delete(id: string, password: string): Promise<boolean> {
    if (!(await this.authorize(id, password))) return false;
    const { changes } = this.db.prepare('DELETE FROM feedbacks WHERE id = ?').run(id);
    return Number(changes) === 1;
  }

  /** Eigene Antwort dieses Geräts. Die responseId ist ein zufälliges Geheimnis des Geräts. */
  getOwnResponse(id: string, responseId: string): OwnResponse | undefined {
    const row = this.db
      .prepare('SELECT version, answers FROM responses WHERE feedback_id = ? AND response_id = ?')
      .get(id, responseId);
    if (!row) return undefined;
    return { version: row.version as number, answers: JSON.parse(row.answers as string) as Answers };
  }

  /** Legt die Antwort eines Geräts an oder ersetzt sie. `version` muss die aktuelle Version sein. */
  submit(id: string, responseId: string, version: unknown, rawAnswers: unknown): FeedbackSubmitResult {
    // IMMEDIATE: Status-, Versions- und Limitprüfung plus Schreiben sind atomar, auch über Prozesse hinweg.
    return this.transaction((): FeedbackSubmitResult => {
      const row = this.row(id);
      if (!row) return { ok: false, reason: 'not-found' };
      if (row.closed) return { ok: false, reason: 'closed' };
      if (version !== row.version) return { ok: false, reason: 'outdated' };

      const answers = parseAnswers(JSON.parse(row.definition) as FeedbackDefinition, rawAnswers);
      if (!answers.ok) return { ok: false, reason: 'invalid', errors: answers.errors };
      const json = JSON.stringify(answers.value);
      const now = this.now();

      const { changes } = this.db
        .prepare(
          'UPDATE responses SET answers = ?, version = ?, updated_at = ? WHERE feedback_id = ? AND response_id = ?',
        )
        .run(json, row.version, now, id, responseId);
      if (Number(changes) === 1) return { ok: true, updated: true };

      const { n } = this.db.prepare('SELECT count(*) AS n FROM responses WHERE feedback_id = ?').get(id) as {
        n: number;
      };
      if (n >= this.maxResponses) return { ok: false, reason: 'full' };
      this.db
        .prepare(
          'INSERT INTO responses (feedback_id, response_id, version, submitted_at, answers) VALUES (?, ?, ?, ?, ?)',
        )
        .run(id, responseId, row.version, now, json);
      return { ok: true, updated: false };
    });
  }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private row(id: string): FeedbackRow | undefined {
    return this.db.prepare(SELECT_FEEDBACK).get(id) as FeedbackRow | undefined;
  }

  private async authorize(id: string, password: string): Promise<FeedbackRow | undefined> {
    const row = this.row(id);
    if (!row) return undefined;
    return (await verifyPassword(password, row.password_hash)) ? row : undefined;
  }
}

function toPublic(row: FeedbackRow): PublicFeedback {
  return {
    id: row.id,
    version: row.version,
    definition: JSON.parse(row.definition) as FeedbackDefinition,
    closed: row.closed === 1,
  };
}

function generateId(): string {
  let id = '';
  for (let i = 0; i < SESSION_ID_LENGTH; i++) id += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return id;
}

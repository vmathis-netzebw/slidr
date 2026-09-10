import { randomInt } from 'node:crypto';
import {
  MAX_RESPONSES_PER_SESSION,
  QUESTION_MAX_LENGTH,
  SESSION_ID_LENGTH,
  VALUE_MAX,
  VALUE_MIN,
  type PresenterSessionState,
  type SessionStats,
  type VoterSessionState,
} from '../shared/protocol.js';
import { computeStats, emptyStats } from '../shared/stats.js';

/** Ohne I, O, 0, 1 – damit die Session-ID vorlesbar und abtippbar bleibt. */
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const DEFAULT_QUESTION = 'Wie stark stimmst du zu?';

/** Sessions ohne Aktivität werden nach dieser Zeit verworfen. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface Session {
  id: string;
  question: string;
  createdAt: number;
  lastActivityAt: number;
  resultsVisible: boolean;
  /** responseId -> value */
  responses: Map<string, number>;
}

export type SubmitResult =
  | { ok: true; value: number; changed: boolean }
  | { ok: false; reason: 'session-not-found' | 'already-voted' | 'session-full' | 'invalid-value' };

export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly maxResponses: number = MAX_RESPONSES_PER_SESSION,
    private readonly now: () => number = Date.now,
  ) {}

  createSession(question?: string): Session {
    const id = this.generateSessionId();
    const timestamp = this.now();
    const session: Session = {
      id,
      question: normalizeQuestion(question) || DEFAULT_QUESTION,
      createdAt: timestamp,
      lastActivityAt: timestamp,
      resultsVisible: true,
      responses: new Map(),
    };
    this.sessions.set(id, session);
    return session;
  }

  getSession(sessionId: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    session.lastActivityAt = this.now();
    return session;
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  get size(): number {
    return this.sessions.size;
  }

  updateQuestion(sessionId: string, question: string): Session | undefined {
    const session = this.getSession(sessionId);
    if (!session) return undefined;
    session.question = normalizeQuestion(question) || DEFAULT_QUESTION;
    return session;
  }

  setResultsVisible(sessionId: string, visible: boolean): Session | undefined {
    const session = this.getSession(sessionId);
    if (!session) return undefined;
    session.resultsVisible = visible;
    return session;
  }

  /** Löscht alle Antworten, behält Frage und Session-ID (und damit den QR-Code). */
  clearResponses(sessionId: string): Session | undefined {
    const session = this.getSession(sessionId);
    if (!session) return undefined;
    session.responses.clear();
    return session;
  }

  /** Setzt die Session komplett zurück: Antworten weg, Frage auf Standard. */
  resetSession(sessionId: string): Session | undefined {
    const session = this.getSession(sessionId);
    if (!session) return undefined;
    session.responses.clear();
    session.question = DEFAULT_QUESTION;
    session.resultsVisible = true;
    return session;
  }

  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  submitResponse(sessionId: string, responseId: string, value: number): SubmitResult {
    const session = this.getSession(sessionId);
    if (!session) return { ok: false, reason: 'session-not-found' };
    if (!isValidValue(value)) return { ok: false, reason: 'invalid-value' };
    if (session.responses.has(responseId)) return { ok: false, reason: 'already-voted' };
    if (session.responses.size >= this.maxResponses) return { ok: false, reason: 'session-full' };

    session.responses.set(responseId, value);
    return { ok: true, value, changed: true };
  }

  getStats(sessionId: string): SessionStats {
    const session = this.sessions.get(sessionId);
    if (!session) return emptyStats();
    return computeStats([...session.responses.values()]);
  }

  getPresenterState(sessionId: string): PresenterSessionState | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    return {
      sessionId: session.id,
      question: session.question,
      createdAt: session.createdAt,
      resultsVisible: session.resultsVisible,
      stats: computeStats([...session.responses.values()]),
    };
  }

  getVoterState(sessionId: string, responseId: string): VoterSessionState | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    const value = session.responses.get(responseId);
    return {
      sessionId: session.id,
      question: session.question,
      hasVoted: value !== undefined,
      value: value ?? null,
      full: session.responses.size >= this.maxResponses,
    };
  }

  /** Entfernt inaktive Sessions; gibt die Anzahl entfernter Sessions zurück. */
  pruneExpired(ttlMs: number = SESSION_TTL_MS): number {
    const cutoff = this.now() - ttlMs;
    let removed = 0;
    for (const [id, session] of this.sessions) {
      if (session.lastActivityAt < cutoff) {
        this.sessions.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  private generateSessionId(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      let id = '';
      for (let i = 0; i < SESSION_ID_LENGTH; i += 1) {
        id += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
      }
      if (!this.sessions.has(id)) return id;
    }
    throw new Error('Konnte keine eindeutige Session-ID erzeugen');
  }
}

export function isValidValue(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= VALUE_MIN &&
    value <= VALUE_MAX
  );
}

export function normalizeQuestion(question: unknown): string {
  if (typeof question !== 'string') return '';
  return question.replace(/\s+/g, ' ').trim().slice(0, QUESTION_MAX_LENGTH);
}

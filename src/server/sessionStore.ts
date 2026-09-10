import { randomInt } from 'node:crypto';
import {
  DEFAULT_LEFT_LABEL,
  DEFAULT_RIGHT_LABEL,
  MAX_RESPONSES_PER_SESSION,
  POLE_LABEL_MAX_LENGTH,
  QUESTION_MAX_LENGTH,
  SESSION_ID_LENGTH,
  VALUE_MAX,
  VALUE_MIN,
  VOTE_EDIT_WINDOW_MS,
  type PresenterSessionState,
  type SessionStats,
  type VoterSessionState,
} from '../shared/protocol.js';
import { computeStats, emptyStats } from '../shared/stats.js';

/** Ohne I, O, 0, 1 – damit die Session-ID vorlesbar und abtippbar bleibt. */
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const DEFAULT_QUESTION = 'Entwickeln oder Customizen?';

/** Sessions ohne Aktivität werden nach dieser Zeit verworfen. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface Response {
  value: number;
  /** Startpunkt des Änderungsfensters – spätere Korrekturen verschieben ihn nicht. */
  firstVotedAt: number;
}

export interface Session {
  id: string;
  question: string;
  /** Linker Pol des Sliders (Wert 0). */
  leftLabel: string;
  /** Rechter Pol des Sliders (Wert 100). */
  rightLabel: string;
  createdAt: number;
  lastActivityAt: number;
  resultsVisible: boolean;
  /** responseId -> Antwort */
  responses: Map<string, Response>;
}

export interface SessionSetup {
  question?: string;
  leftLabel?: string;
  rightLabel?: string;
}

export type SubmitResult =
  | { ok: true; value: number; changed: boolean }
  | { ok: false; reason: 'session-not-found' | 'already-voted' | 'session-full' | 'invalid-value' };

export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly maxResponses: number = MAX_RESPONSES_PER_SESSION,
    private readonly now: () => number = Date.now,
    private readonly editWindowMs: number = VOTE_EDIT_WINDOW_MS,
  ) {}

  createSession(setup: SessionSetup | string = {}): Session {
    const options: SessionSetup = typeof setup === 'string' ? { question: setup } : setup;
    const id = this.generateSessionId();
    const timestamp = this.now();
    const session: Session = {
      id,
      question: normalizeQuestion(options.question) || DEFAULT_QUESTION,
      leftLabel: normalizePoleLabel(options.leftLabel) || DEFAULT_LEFT_LABEL,
      rightLabel: normalizePoleLabel(options.rightLabel) || DEFAULT_RIGHT_LABEL,
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

  updateQuestion(sessionId: string, setup: SessionSetup): Session | undefined {
    const session = this.getSession(sessionId);
    if (!session) return undefined;
    if (setup.question !== undefined) {
      session.question = normalizeQuestion(setup.question) || DEFAULT_QUESTION;
    }
    if (setup.leftLabel !== undefined) {
      session.leftLabel = normalizePoleLabel(setup.leftLabel) || DEFAULT_LEFT_LABEL;
    }
    if (setup.rightLabel !== undefined) {
      session.rightLabel = normalizePoleLabel(setup.rightLabel) || DEFAULT_RIGHT_LABEL;
    }
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
    session.leftLabel = DEFAULT_LEFT_LABEL;
    session.rightLabel = DEFAULT_RIGHT_LABEL;
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

    const existing = session.responses.get(responseId);
    if (existing) {
      if (this.remainingEditMs(existing) <= 0) return { ok: false, reason: 'already-voted' };
      const changed = existing.value !== value;
      existing.value = value;
      return { ok: true, value, changed };
    }

    if (session.responses.size >= this.maxResponses) return { ok: false, reason: 'session-full' };
    session.responses.set(responseId, { value, firstVotedAt: this.now() });
    return { ok: true, value, changed: true };
  }

  getStats(sessionId: string): SessionStats {
    const session = this.sessions.get(sessionId);
    if (!session) return emptyStats();
    return computeStats(valuesOf(session));
  }

  getPresenterState(sessionId: string): PresenterSessionState | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    return {
      sessionId: session.id,
      question: session.question,
      leftLabel: session.leftLabel,
      rightLabel: session.rightLabel,
      createdAt: session.createdAt,
      resultsVisible: session.resultsVisible,
      stats: computeStats(valuesOf(session)),
    };
  }

  getVoterState(sessionId: string, responseId: string): VoterSessionState | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    const response = session.responses.get(responseId);
    return {
      sessionId: session.id,
      question: session.question,
      leftLabel: session.leftLabel,
      rightLabel: session.rightLabel,
      hasVoted: response !== undefined,
      value: response?.value ?? null,
      editableForMs: response ? this.remainingEditMs(response) : this.editWindowMs,
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

  private remainingEditMs(response: Response): number {
    return Math.max(0, response.firstVotedAt + this.editWindowMs - this.now());
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

function valuesOf(session: Session): number[] {
  const values: number[] = [];
  for (const response of session.responses.values()) values.push(response.value);
  return values;
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

export function normalizePoleLabel(label: unknown): string {
  if (typeof label !== 'string') return '';
  return label.replace(/\s+/g, ' ').trim().slice(0, POLE_LABEL_MAX_LENGTH);
}

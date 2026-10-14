import type { ServerErrorCode, ServerMessage } from '../shared/protocol.js';
import { RateLimiter } from './rateLimiter.js';
import type { Theme } from '../shared/theme.js';
import { SessionStore, type SessionSetup } from './sessionStore.js';
import { parseClientMessage } from './validation.js';

/** Minimale Sicht auf eine WebSocket-Verbindung – erlaubt Tests ohne echte Sockets. */
export interface ConnectionLike {
  send(data: string): void;
  close(): void;
}

export interface PollHubOptions {
  /** Nachrichten pro Verbindung (Burst). */
  messageBurst?: number;
  /** Nachfüllrate in Nachrichten pro Sekunde. */
  messagesPerSecond?: number;
  /** Abstimmungs-Burst pro Client-Key (z.B. IP). */
  voteBurst?: number;
  /** Nachfüllrate für Abstimmungen pro Sekunde. */
  votesPerSecond?: number;
  now?: () => number;
}

interface ConnectionState {
  connection: ConnectionLike;
  clientKey: string;
  connectionKey: string;
  role: 'unknown' | 'presenter' | 'voter';
  sessionId: string | null;
  responseId: string | null;
}

export class PollHub {
  private readonly presentersBySession = new Map<string, Set<ConnectionState>>();
  private readonly connections = new Set<ConnectionState>();
  private readonly messageLimiter: RateLimiter;
  private readonly voteLimiter: RateLimiter;
  private nextConnectionId = 0;

  constructor(
    private readonly store: SessionStore,
    options: PollHubOptions = {},
  ) {
    const now = options.now ?? Date.now;
    this.messageLimiter = new RateLimiter(options.messageBurst ?? 40, options.messagesPerSecond ?? 8, now);
    // Korrekturen im Änderungsfenster erzeugen mehrere Abgaben pro Teilnehmer.
    this.voteLimiter = new RateLimiter(options.voteBurst ?? 30, options.votesPerSecond ?? 1, now);
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  presenterCount(sessionId: string): number {
    return this.presentersBySession.get(sessionId)?.size ?? 0;
  }

  addConnection(connection: ConnectionLike, clientKey: string): ConnectionState {
    this.nextConnectionId += 1;
    const state: ConnectionState = {
      connection,
      clientKey,
      connectionKey: `conn:${this.nextConnectionId}`,
      role: 'unknown',
      sessionId: null,
      responseId: null,
    };
    this.connections.add(state);
    return state;
  }

  removeConnection(state: ConnectionState): void {
    this.connections.delete(state);
    this.messageLimiter.release(state.connectionKey);
    if (state.sessionId) {
      const presenters = this.presentersBySession.get(state.sessionId);
      if (presenters) {
        presenters.delete(state);
        if (presenters.size === 0) this.presentersBySession.delete(state.sessionId);
      }
    }
  }

  handleRawMessage(state: ConnectionState, raw: string): void {
    if (!this.messageLimiter.tryConsume(state.connectionKey)) {
      this.sendError(state, 'rate-limited', 'Zu viele Anfragen.');
      return;
    }

    const message = parseClientMessage(raw);
    if (!message) {
      this.sendError(state, 'invalid-message', 'Ungültige Nachricht.');
      return;
    }

    switch (message.type) {
      case 'presenter:hello': {
        const existing = message.sessionId ? this.store.getSession(message.sessionId) : undefined;
        const session = existing ?? this.store.createSession(setupFrom(message));
        this.attachPresenter(state, session.id);
        this.sendPresenterState(state, session.id);
        return;
      }

      case 'presenter:new-session': {
        const session = this.store.createSession(setupFrom(message));
        this.attachPresenter(state, session.id);
        this.sendPresenterState(state, session.id);
        return;
      }

      case 'presenter:update-question': {
        if (!this.assertPresenterOwns(state, message.sessionId)) return;
        if (!this.store.updateQuestion(message.sessionId, setupFrom(message))) {
          this.sendError(state, 'session-not-found', 'Session existiert nicht.');
          return;
        }
        this.broadcastPresenterState(message.sessionId);
        this.broadcastVoterStates(message.sessionId);
        return;
      }

      case 'presenter:set-results-visible': {
        if (!this.assertPresenterOwns(state, message.sessionId)) return;
        if (!this.store.setResultsVisible(message.sessionId, message.visible)) {
          this.sendError(state, 'session-not-found', 'Session existiert nicht.');
          return;
        }
        this.broadcastPresenterState(message.sessionId);
        return;
      }

      case 'presenter:clear-responses': {
        if (!this.assertPresenterOwns(state, message.sessionId)) return;
        if (!this.store.clearResponses(message.sessionId)) {
          this.sendError(state, 'session-not-found', 'Session existiert nicht.');
          return;
        }
        this.broadcastPresenterState(message.sessionId);
        this.broadcastVoterStates(message.sessionId);
        return;
      }

      case 'presenter:reset-session': {
        if (!this.assertPresenterOwns(state, message.sessionId)) return;
        if (!this.store.resetSession(message.sessionId)) {
          this.sendError(state, 'session-not-found', 'Session existiert nicht.');
          return;
        }
        this.broadcastPresenterState(message.sessionId);
        this.broadcastVoterStates(message.sessionId);
        return;
      }

      case 'voter:hello': {
        const voterState = this.store.getVoterState(message.sessionId, message.responseId);
        if (!voterState) {
          this.sendError(state, 'session-not-found', 'Diese Umfrage ist nicht (mehr) aktiv.');
          return;
        }
        state.role = 'voter';
        state.sessionId = message.sessionId;
        state.responseId = message.responseId;
        this.send(state, { type: 'voter:state', state: voterState });
        return;
      }

      case 'voter:submit': {
        if (!this.voteLimiter.tryConsume(state.clientKey)) {
          this.sendError(state, 'rate-limited', 'Zu viele Abstimmungen. Bitte kurz warten.');
          return;
        }

        state.role = 'voter';
        state.sessionId = message.sessionId;
        state.responseId = message.responseId;

        const result = this.store.submitResponse(message.sessionId, message.responseId, message.value);
        if (!result.ok) {
          const voterState = this.store.getVoterState(message.sessionId, message.responseId);
          if (voterState) this.send(state, { type: 'voter:state', state: voterState });
          this.sendError(state, errorCodeFor(result.reason), errorTextFor(result.reason));
          return;
        }

        this.send(state, { type: 'voter:accepted', value: result.value });
        const voterState = this.store.getVoterState(message.sessionId, message.responseId);
        if (voterState) this.send(state, { type: 'voter:state', state: voterState });
        this.broadcastPresenterState(message.sessionId);
        return;
      }

      default: {
        const exhaustive: never = message;
        void exhaustive;
      }
    }
  }

  broadcastPresenterState(sessionId: string): void {
    const presenters = this.presentersBySession.get(sessionId);
    if (!presenters || presenters.size === 0) return;
    const presenterState = this.store.getPresenterState(sessionId);
    if (!presenterState) return;
    const payload = JSON.stringify({ type: 'presenter:state', state: presenterState } satisfies ServerMessage);
    for (const presenter of presenters) {
      this.safeSend(presenter, payload);
    }
  }

  /** Informiert alle Voter-Verbindungen einer Session (z.B. nach Frage-Änderung oder Reset). */
  broadcastVoterStates(sessionId: string): void {
    for (const state of this.connections) {
      if (state.role !== 'voter' || state.sessionId !== sessionId || !state.responseId) continue;
      const voterState = this.store.getVoterState(sessionId, state.responseId);
      if (voterState) this.send(state, { type: 'voter:state', state: voterState });
    }
  }

  private attachPresenter(state: ConnectionState, sessionId: string): void {
    if (state.sessionId && state.sessionId !== sessionId) {
      this.presentersBySession.get(state.sessionId)?.delete(state);
    }
    state.role = 'presenter';
    state.sessionId = sessionId;
    let presenters = this.presentersBySession.get(sessionId);
    if (!presenters) {
      presenters = new Set();
      this.presentersBySession.set(sessionId, presenters);
    }
    presenters.add(state);
  }

  private assertPresenterOwns(state: ConnectionState, sessionId: string): boolean {
    if (state.role !== 'presenter' || state.sessionId !== sessionId) {
      this.sendError(state, 'not-authorized', 'Diese Verbindung steuert die Session nicht.');
      return false;
    }
    return true;
  }

  private sendPresenterState(state: ConnectionState, sessionId: string): void {
    const presenterState = this.store.getPresenterState(sessionId);
    if (!presenterState) {
      this.sendError(state, 'session-not-found', 'Session existiert nicht.');
      return;
    }
    this.send(state, { type: 'presenter:state', state: presenterState });
  }

  private sendError(state: ConnectionState, code: ServerErrorCode, message: string): void {
    this.send(state, { type: 'error', code, message });
  }

  private send(state: ConnectionState, message: ServerMessage): void {
    this.safeSend(state, JSON.stringify(message));
  }

  private safeSend(state: ConnectionState, payload: string): void {
    try {
      state.connection.send(payload);
    } catch {
      this.removeConnection(state);
    }
  }
}

function setupFrom(message: {
  question?: string;
  leftLabel?: string;
  rightLabel?: string;
  theme?: Theme;
}): SessionSetup {
  return {
    ...(message.theme !== undefined ? { theme: message.theme } : {}),
    ...(message.question !== undefined ? { question: message.question } : {}),
    ...(message.leftLabel !== undefined ? { leftLabel: message.leftLabel } : {}),
    ...(message.rightLabel !== undefined ? { rightLabel: message.rightLabel } : {}),
  };
}

function errorCodeFor(reason: 'session-not-found' | 'already-voted' | 'session-full' | 'invalid-value'): ServerErrorCode {
  switch (reason) {
    case 'session-not-found':
      return 'session-not-found';
    case 'already-voted':
      return 'already-voted';
    case 'session-full':
      return 'session-full';
    case 'invalid-value':
      return 'invalid-value';
  }
}

function errorTextFor(reason: 'session-not-found' | 'already-voted' | 'session-full' | 'invalid-value'): string {
  switch (reason) {
    case 'session-not-found':
      return 'Diese Umfrage ist nicht (mehr) aktiv.';
    case 'already-voted':
      return 'Die Zeit zum Ändern deiner Antwort ist abgelaufen.';
    case 'session-full':
      return 'Diese Umfrage nimmt keine weiteren Antworten an.';
    case 'invalid-value':
      return 'Ungültiger Wert.';
  }
}

export type { ConnectionState };

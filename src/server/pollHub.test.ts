import { beforeEach, describe, expect, it } from 'vitest';
import type { PresenterSessionState, ServerMessage, VoterSessionState } from '../shared/protocol.js';
import { PollHub, type ConnectionLike } from './pollHub.js';
import { SessionStore } from './sessionStore.js';

class FakeConnection implements ConnectionLike {
  readonly sent: ServerMessage[] = [];
  closed = false;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ServerMessage);
  }

  close(): void {
    this.closed = true;
  }

  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      const message = this.sent[i];
      if (message?.type === type) return message as Extract<ServerMessage, { type: T }>;
    }
    return undefined;
  }

  clear(): void {
    this.sent.length = 0;
  }
}

function send(hub: PollHub, state: ReturnType<PollHub['addConnection']>, message: unknown): void {
  hub.handleRawMessage(state, JSON.stringify(message));
}

let store: SessionStore;
let hub: PollHub;

beforeEach(() => {
  store = new SessionStore();
  hub = new PollHub(store, { voteBurst: 1000, messageBurst: 1000 });
});

function startPresenter(question = 'Entwickeln oder Customizen?'): {
  connection: FakeConnection;
  state: ReturnType<PollHub['addConnection']>;
  sessionId: string;
} {
  const connection = new FakeConnection();
  const state = hub.addConnection(connection, 'presenter-ip');
  send(hub, state, { type: 'presenter:new-session', question });
  const message = connection.last('presenter:state');
  expect(message).toBeDefined();
  return { connection, state, sessionId: (message as { state: PresenterSessionState }).state.sessionId };
}

describe('PollHub – Session-Erstellung', () => {
  it('erzeugt beim presenter:new-session eine Session und liefert den Zustand', () => {
    const { connection, sessionId } = startPresenter('Wie sicher fühlst du dich?');
    const message = connection.last('presenter:state')!;
    expect(message.state.question).toBe('Wie sicher fühlst du dich?');
    expect(message.state.stats.count).toBe(0);
    expect(store.hasSession(sessionId)).toBe(true);
  });

  it('presenter:hello mit bekannter Session lädt sie erneut (Reconnect)', () => {
    const { sessionId } = startPresenter();
    const reconnect = new FakeConnection();
    const state = hub.addConnection(reconnect, 'presenter-ip');
    send(hub, state, { type: 'presenter:hello', sessionId });
    expect(reconnect.last('presenter:state')?.state.sessionId).toBe(sessionId);
    expect(hub.presenterCount(sessionId)).toBe(2);
  });
});

describe('PollHub – Abstimmen', () => {
  it('speichert eine Antwort und bestätigt sie dem Teilnehmer', () => {
    const { sessionId } = startPresenter();
    const voter = new FakeConnection();
    const voterState = hub.addConnection(voter, 'voter-1');

    send(hub, voterState, { type: 'voter:submit', sessionId, responseId: 'a'.repeat(16), value: 67 });

    expect(voter.last('voter:accepted')?.value).toBe(67);
    expect(voter.last('voter:state')?.state).toMatchObject({ hasVoted: true, value: 67 });
    expect(store.getStats(sessionId).count).toBe(1);
  });

  it('lehnt eine doppelte responseId ab und meldet den bestehenden Zustand', () => {
    const { sessionId } = startPresenter();
    const voter = new FakeConnection();
    const voterState = hub.addConnection(voter, 'voter-1');
    const responseId = 'b'.repeat(16);

    send(hub, voterState, { type: 'voter:submit', sessionId, responseId, value: 20 });
    voter.clear();
    send(hub, voterState, { type: 'voter:submit', sessionId, responseId, value: 90 });

    expect(voter.last('error')?.code).toBe('already-voted');
    expect(voter.last('voter:state')?.state.value).toBe(20);
    expect(store.getStats(sessionId).count).toBe(1);
  });

  it('lehnt ungültige Werte ab, ohne die Session zu verändern', () => {
    const { sessionId } = startPresenter();
    const voter = new FakeConnection();
    const voterState = hub.addConnection(voter, 'voter-1');

    send(hub, voterState, { type: 'voter:submit', sessionId, responseId: 'c'.repeat(16), value: 150 });

    expect(voter.last('error')?.code).toBe('invalid-message');
    expect(store.getStats(sessionId).count).toBe(0);
  });

  it('lehnt Abstimmungen für unbekannte Sessions ab', () => {
    const voter = new FakeConnection();
    const voterState = hub.addConnection(voter, 'voter-1');
    send(hub, voterState, {
      type: 'voter:submit',
      sessionId: 'ZZZZZZZZZZ',
      responseId: 'd'.repeat(16),
      value: 50,
    });
    expect(voter.last('error')?.code).toBe('session-not-found');
  });

  it('voter:hello liefert den bestehenden Zustand nach Reload', () => {
    const { sessionId } = startPresenter('Frage?');
    const responseId = 'e'.repeat(16);
    const first = new FakeConnection();
    send(hub, hub.addConnection(first, 'voter-1'), {
      type: 'voter:submit',
      sessionId,
      responseId,
      value: 42,
    });

    const reloaded = new FakeConnection();
    send(hub, hub.addConnection(reloaded, 'voter-1'), { type: 'voter:hello', sessionId, responseId });

    const state = reloaded.last('voter:state')?.state as VoterSessionState;
    expect(state).toMatchObject({ hasVoted: true, value: 42, question: 'Frage?' });
  });
});

describe('PollHub – WebSocket Broadcast', () => {
  it('informiert alle Presenter einer Session über neue Antworten', () => {
    const { connection: presenterA, sessionId } = startPresenter();
    const presenterB = new FakeConnection();
    send(hub, hub.addConnection(presenterB, 'presenter-2'), { type: 'presenter:hello', sessionId });

    presenterA.clear();
    presenterB.clear();

    const voter = new FakeConnection();
    send(hub, hub.addConnection(voter, 'voter-1'), {
      type: 'voter:submit',
      sessionId,
      responseId: 'f'.repeat(16),
      value: 80,
    });

    for (const presenter of [presenterA, presenterB]) {
      const state = presenter.last('presenter:state')?.state;
      expect(state?.stats.count).toBe(1);
      expect(state?.stats.average).toBe(80);
      expect(state?.stats.median).toBe(80);
    }
  });

  it('sendet keine Presenter-Updates an andere Sessions', () => {
    const { sessionId: sessionA } = startPresenter('A');
    const { connection: presenterB } = startPresenter('B');
    presenterB.clear();

    const voter = new FakeConnection();
    send(hub, hub.addConnection(voter, 'voter-1'), {
      type: 'voter:submit',
      sessionId: sessionA,
      responseId: 'g'.repeat(16),
      value: 10,
    });

    expect(presenterB.last('presenter:state')).toBeUndefined();
  });

  it('entfernte Verbindungen erhalten keine Broadcasts mehr', () => {
    const { connection: presenter, state: presenterState, sessionId } = startPresenter();
    hub.removeConnection(presenterState);
    presenter.clear();

    send(hub, hub.addConnection(new FakeConnection(), 'voter-1'), {
      type: 'voter:submit',
      sessionId,
      responseId: 'h'.repeat(16),
      value: 30,
    });

    expect(presenter.sent).toHaveLength(0);
    expect(hub.presenterCount(sessionId)).toBe(0);
  });

  it('benachrichtigt Teilnehmer über eine geänderte Frage', () => {
    const { state: presenterState, sessionId } = startPresenter('Alt');
    const voter = new FakeConnection();
    const voterState = hub.addConnection(voter, 'voter-1');
    send(hub, voterState, { type: 'voter:hello', sessionId, responseId: 'i'.repeat(16) });
    voter.clear();

    send(hub, presenterState, { type: 'presenter:update-question', sessionId, question: 'Neu' });

    expect(voter.last('voter:state')?.state.question).toBe('Neu');
  });

  it('überträgt die Slider-Pole an Presenter und Teilnehmer', () => {
    const connection = new FakeConnection();
    const presenterState = hub.addConnection(connection, 'presenter-ip');
    send(hub, presenterState, {
      type: 'presenter:new-session',
      question: 'Wie baust du?',
      leftLabel: 'Entwickeln',
      rightLabel: 'Customizen',
    });
    const sessionId = connection.last('presenter:state')!.state.sessionId;
    expect(connection.last('presenter:state')?.state).toMatchObject({
      leftLabel: 'Entwickeln',
      rightLabel: 'Customizen',
    });

    const voter = new FakeConnection();
    send(hub, hub.addConnection(voter, 'voter-1'), {
      type: 'voter:hello',
      sessionId,
      responseId: 'n'.repeat(16),
    });
    expect(voter.last('voter:state')?.state).toMatchObject({
      leftLabel: 'Entwickeln',
      rightLabel: 'Customizen',
    });
  });
});

describe('PollHub – Reset und Steuerung', () => {
  it('löscht Antworten und aktualisiert Presenter und Teilnehmer', () => {
    const { connection: presenter, state: presenterState, sessionId } = startPresenter();
    const voter = new FakeConnection();
    const voterState = hub.addConnection(voter, 'voter-1');
    const responseId = 'j'.repeat(16);
    send(hub, voterState, { type: 'voter:submit', sessionId, responseId, value: 55 });

    presenter.clear();
    voter.clear();
    send(hub, presenterState, { type: 'presenter:clear-responses', sessionId });

    expect(presenter.last('presenter:state')?.state.stats.count).toBe(0);
    expect(voter.last('voter:state')?.state.hasVoted).toBe(false);
  });

  it('setzt die Session vollständig zurück', () => {
    const { connection: presenter, state: presenterState, sessionId } = startPresenter('Meine Frage');
    send(hub, hub.addConnection(new FakeConnection(), 'voter-1'), {
      type: 'voter:submit',
      sessionId,
      responseId: 'k'.repeat(16),
      value: 55,
    });

    presenter.clear();
    send(hub, presenterState, { type: 'presenter:reset-session', sessionId });

    const state = presenter.last('presenter:state')?.state;
    expect(state?.stats.count).toBe(0);
    expect(state?.question).toBe('Entwickeln oder Customizen?');
    expect(state?.sessionId).toBe(sessionId);
  });

  it('blendet Ergebnisse aus und wieder ein', () => {
    const { connection: presenter, state: presenterState, sessionId } = startPresenter();
    send(hub, presenterState, { type: 'presenter:set-results-visible', sessionId, visible: false });
    expect(presenter.last('presenter:state')?.state.resultsVisible).toBe(false);
    send(hub, presenterState, { type: 'presenter:set-results-visible', sessionId, visible: true });
    expect(presenter.last('presenter:state')?.state.resultsVisible).toBe(true);
  });

  it('verhindert Steuerbefehle von fremden Verbindungen', () => {
    const { sessionId } = startPresenter();
    const attacker = new FakeConnection();
    const attackerState = hub.addConnection(attacker, 'attacker');

    send(hub, attackerState, { type: 'presenter:reset-session', sessionId });

    expect(attacker.last('error')?.code).toBe('not-authorized');
  });
});

describe('PollHub – Rate Limiting', () => {
  it('blockiert zu viele Nachrichten einer Verbindung', () => {
    const limited = new PollHub(store, { messageBurst: 2, messagesPerSecond: 0 });
    const connection = new FakeConnection();
    const state = limited.addConnection(connection, 'spammer');

    for (let i = 0; i < 5; i += 1) {
      limited.handleRawMessage(state, JSON.stringify({ type: 'presenter:hello' }));
    }

    expect(connection.last('error')?.code).toBe('rate-limited');
    expect(connection.sent.filter((m) => m.type === 'presenter:state')).toHaveLength(2);
  });

  it('begrenzt Abstimmungen pro Client-Key', () => {
    const limited = new PollHub(store, { voteBurst: 1, votesPerSecond: 0 });
    const presenterConn = new FakeConnection();
    const presenterState = limited.addConnection(presenterConn, 'presenter');
    limited.handleRawMessage(presenterState, JSON.stringify({ type: 'presenter:new-session' }));
    const sessionId = presenterConn.last('presenter:state')!.state.sessionId;

    const voter = new FakeConnection();
    const voterState = limited.addConnection(voter, 'same-ip');
    limited.handleRawMessage(
      voterState,
      JSON.stringify({ type: 'voter:submit', sessionId, responseId: 'l'.repeat(16), value: 10 }),
    );
    limited.handleRawMessage(
      voterState,
      JSON.stringify({ type: 'voter:submit', sessionId, responseId: 'm'.repeat(16), value: 20 }),
    );

    expect(voter.last('error')?.code).toBe('rate-limited');
    expect(store.getStats(sessionId).count).toBe(1);
  });
});

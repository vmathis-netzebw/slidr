import { describe, expect, it } from 'vitest';
import { SESSION_ID_PATTERN } from '../shared/protocol.js';
import { DEFAULT_LEFT_LABEL, DEFAULT_RIGHT_LABEL } from '../shared/protocol.js';
import { DEFAULT_QUESTION, SessionStore, normalizePoleLabel, normalizeQuestion } from './sessionStore.js';

describe('SessionStore – Session-Erstellung', () => {
  it('erzeugt eine gültige, ausreichend zufällige Session-ID', () => {
    const store = new SessionStore();
    const ids = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const session = store.createSession('Frage?');
      expect(SESSION_ID_PATTERN.test(session.id)).toBe(true);
      expect(session.id.length).toBe(10);
      ids.add(session.id);
    }
    expect(ids.size).toBe(200);
  });

  it('übernimmt die Frage und fällt sonst auf den Standard zurück', () => {
    const store = new SessionStore();
    expect(store.createSession('  Wie   sicher?  ').question).toBe('Wie sicher?');
    expect(store.createSession().question).toBe(DEFAULT_QUESTION);
    expect(store.createSession('   ').question).toBe(DEFAULT_QUESTION);
  });

  it('kürzt zu lange Fragen', () => {
    expect(normalizeQuestion('x'.repeat(500)).length).toBe(200);
  });

  it('setzt die Slider-Pole und fällt auf Entwickeln/Customizen zurück', () => {
    const store = new SessionStore();
    const custom = store.createSession({
      question: 'Wie baust du?',
      leftLabel: '  Standard  ',
      rightLabel: 'Eigenentwicklung',
    });
    expect(custom.leftLabel).toBe('Standard');
    expect(custom.rightLabel).toBe('Eigenentwicklung');

    const fallback = store.createSession({ leftLabel: '   ' });
    expect(fallback.leftLabel).toBe(DEFAULT_LEFT_LABEL);
    expect(fallback.rightLabel).toBe(DEFAULT_RIGHT_LABEL);
  });

  it('kürzt zu lange Pol-Bezeichnungen', () => {
    expect(normalizePoleLabel('x'.repeat(200)).length).toBe(24);
  });
});

describe('SessionStore – Antworten speichern', () => {
  it('speichert eine gültige Antwort', () => {
    const store = new SessionStore();
    const session = store.createSession('Frage?');
    const result = store.submitResponse(session.id, 'a'.repeat(16), 67);
    expect(result).toEqual({ ok: true, value: 67, changed: true });
    expect(store.getStats(session.id).count).toBe(1);
  });

  it('erlaubt eine Korrektur innerhalb des Änderungsfensters', () => {
    let now = 1_000_000;
    const store = new SessionStore(10_000, () => now, 120_000);
    const session = store.createSession();
    const responseId = 'b'.repeat(16);

    expect(store.submitResponse(session.id, responseId, 10).ok).toBe(true);
    now += 119_000;
    expect(store.submitResponse(session.id, responseId, 90)).toEqual({
      ok: true,
      value: 90,
      changed: true,
    });

    const stats = store.getStats(session.id);
    expect(stats.count).toBe(1);
    expect(stats.average).toBe(90);
  });

  it('meldet changed:false, wenn der Wert gleich bleibt', () => {
    const store = new SessionStore();
    const session = store.createSession();
    const responseId = 'e'.repeat(16);
    store.submitResponse(session.id, responseId, 42);
    expect(store.submitResponse(session.id, responseId, 42)).toEqual({
      ok: true,
      value: 42,
      changed: false,
    });
  });

  it('lehnt eine Korrektur nach Ablauf des Änderungsfensters ab', () => {
    let now = 1_000_000;
    const store = new SessionStore(10_000, () => now, 120_000);
    const session = store.createSession();
    const responseId = 'b'.repeat(16);

    expect(store.submitResponse(session.id, responseId, 10).ok).toBe(true);
    now += 120_001;
    expect(store.submitResponse(session.id, responseId, 90)).toEqual({
      ok: false,
      reason: 'already-voted',
    });

    const stats = store.getStats(session.id);
    expect(stats.count).toBe(1);
    expect(stats.average).toBe(10);
  });

  it('verlängert das Änderungsfenster nicht durch eine Korrektur', () => {
    let now = 1_000_000;
    const store = new SessionStore(10_000, () => now, 120_000);
    const session = store.createSession();
    const responseId = 'f'.repeat(16);

    store.submitResponse(session.id, responseId, 10);
    now += 60_000;
    expect(store.submitResponse(session.id, responseId, 20).ok).toBe(true);
    now += 61_000;
    expect(store.submitResponse(session.id, responseId, 30)).toEqual({
      ok: false,
      reason: 'already-voted',
    });
  });

  it('lehnt ungültige Werte ab', () => {
    const store = new SessionStore();
    const session = store.createSession();
    for (const value of [-1, 101, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(store.submitResponse(session.id, `id${value}`.padEnd(16, '0'), value)).toEqual({
        ok: false,
        reason: 'invalid-value',
      });
    }
    expect(store.getStats(session.id).count).toBe(0);
  });

  it('akzeptiert die Randwerte 0 und 100', () => {
    const store = new SessionStore();
    const session = store.createSession();
    expect(store.submitResponse(session.id, 'x'.repeat(16), 0).ok).toBe(true);
    expect(store.submitResponse(session.id, 'y'.repeat(16), 100).ok).toBe(true);
    expect(store.getStats(session.id).average).toBe(50);
  });

  it('lehnt Antworten für unbekannte Sessions ab', () => {
    const store = new SessionStore();
    expect(store.submitResponse('ZZZZZZZZZZ', 'a'.repeat(16), 50)).toEqual({
      ok: false,
      reason: 'session-not-found',
    });
  });

  it('begrenzt die Anzahl der Antworten pro Session', () => {
    const store = new SessionStore(3);
    const session = store.createSession();
    for (let i = 0; i < 3; i += 1) {
      expect(store.submitResponse(session.id, `resp${i}`.padEnd(16, '0'), 50).ok).toBe(true);
    }
    expect(store.submitResponse(session.id, 'overflow'.padEnd(16, '0'), 50)).toEqual({
      ok: false,
      reason: 'session-full',
    });
    expect(store.getStats(session.id).count).toBe(3);
  });

  it('isoliert Sessions voneinander', () => {
    const store = new SessionStore();
    const a = store.createSession('A');
    const b = store.createSession('B');
    const responseId = 'c'.repeat(16);

    expect(store.submitResponse(a.id, responseId, 20).ok).toBe(true);
    // Dieselbe responseId ist in einer anderen Session weiterhin gültig.
    expect(store.submitResponse(b.id, responseId, 80).ok).toBe(true);

    expect(store.getStats(a.id).average).toBe(20);
    expect(store.getStats(b.id).average).toBe(80);
  });
});

describe('SessionStore – Reset', () => {
  it('clearResponses löscht Antworten, behält Frage und ID', () => {
    const store = new SessionStore();
    const session = store.createSession('Meine Frage');
    store.submitResponse(session.id, 'a'.repeat(16), 42);

    const cleared = store.clearResponses(session.id);
    expect(cleared?.id).toBe(session.id);
    expect(cleared?.question).toBe('Meine Frage');
    expect(store.getStats(session.id).count).toBe(0);
    // Nach dem Löschen darf dieselbe responseId erneut abstimmen.
    expect(store.submitResponse(session.id, 'a'.repeat(16), 42).ok).toBe(true);
  });

  it('resetSession setzt Antworten, Frage und Pole zurück', () => {
    const store = new SessionStore();
    const session = store.createSession({
      question: 'Meine Frage',
      leftLabel: 'Links',
      rightLabel: 'Rechts',
    });
    store.submitResponse(session.id, 'a'.repeat(16), 42);
    store.setResultsVisible(session.id, false);

    const reset = store.resetSession(session.id);
    expect(reset?.question).toBe(DEFAULT_QUESTION);
    expect(reset?.leftLabel).toBe(DEFAULT_LEFT_LABEL);
    expect(reset?.rightLabel).toBe(DEFAULT_RIGHT_LABEL);
    expect(reset?.resultsVisible).toBe(true);
    expect(store.getStats(session.id).count).toBe(0);
  });

  it('gibt undefined für unbekannte Sessions zurück', () => {
    const store = new SessionStore();
    expect(store.resetSession('ZZZZZZZZZZ')).toBeUndefined();
    expect(store.clearResponses('ZZZZZZZZZZ')).toBeUndefined();
    expect(store.getPresenterState('ZZZZZZZZZZ')).toBeUndefined();
    expect(store.getVoterState('ZZZZZZZZZZ', 'a'.repeat(16))).toBeUndefined();
  });
});

describe('SessionStore – Zustände', () => {
  it('meldet dem Teilnehmer den bereits abgegebenen Wert', () => {
    let now = 1_000_000;
    const store = new SessionStore(10_000, () => now, 120_000);
    const session = store.createSession('Frage?');
    const responseId = 'd'.repeat(16);

    expect(store.getVoterState(session.id, responseId)).toEqual({
      sessionId: session.id,
      question: 'Frage?',
      leftLabel: DEFAULT_LEFT_LABEL,
      rightLabel: DEFAULT_RIGHT_LABEL,
      hasVoted: false,
      value: null,
      editableForMs: 120_000,
      full: false,
    });

    store.submitResponse(session.id, responseId, 33);
    expect(store.getVoterState(session.id, responseId)).toMatchObject({
      hasVoted: true,
      value: 33,
      editableForMs: 120_000,
    });

    now += 90_000;
    expect(store.getVoterState(session.id, responseId)?.editableForMs).toBe(30_000);

    now += 30_000;
    expect(store.getVoterState(session.id, responseId)?.editableForMs).toBe(0);
  });

  it('entfernt abgelaufene Sessions', () => {
    let now = 1_000_000;
    const store = new SessionStore(10_000, () => now);
    const session = store.createSession();
    now += 60_000;
    expect(store.pruneExpired(30_000)).toBe(1);
    expect(store.hasSession(session.id)).toBe(false);
  });
});

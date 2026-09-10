import { describe, expect, it } from 'vitest';
import { isValidResponseId, isValidSessionId, parseClientMessage } from './validation.js';

const SESSION_ID = 'AB72KD93XY';
const RESPONSE_ID = 'a'.repeat(32);

describe('Session-ID Validierung', () => {
  it('akzeptiert gültige IDs', () => {
    expect(isValidSessionId('AB72KD93')).toBe(true);
    expect(isValidSessionId(SESSION_ID)).toBe(true);
  });

  it('lehnt mehrdeutige und ungültige Zeichen ab', () => {
    // 0, 1, I, O sind bewusst nicht im Alphabet, damit Codes vorlesbar bleiben.
    for (const id of ['', 'abc', 'ab72kd93', 'AB72KD9', 'AB72KD93XYZAB', 'AB72KD9!', 'AB72KD01', 'AB72KDI3', null, 42]) {
      expect(isValidSessionId(id)).toBe(false);
    }
  });

  it('validiert responseIds', () => {
    expect(isValidResponseId(RESPONSE_ID)).toBe(true);
    expect(isValidResponseId('short')).toBe(false);
    expect(isValidResponseId('A'.repeat(32))).toBe(false);
    expect(isValidResponseId('x'.repeat(100))).toBe(false);
  });
});

describe('parseClientMessage', () => {
  it('lehnt kaputtes JSON und Fremdformate ab', () => {
    expect(parseClientMessage('nicht json')).toBeNull();
    expect(parseClientMessage('[]')).toBeNull();
    expect(parseClientMessage('"text"')).toBeNull();
    expect(parseClientMessage('{"type":"unbekannt"}')).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'x'.repeat(5000) }))).toBeNull();
  });

  it('parst voter:submit mit gültigen Werten', () => {
    const message = parseClientMessage(
      JSON.stringify({ type: 'voter:submit', sessionId: SESSION_ID, responseId: RESPONSE_ID, value: 67 }),
    );
    expect(message).toEqual({
      type: 'voter:submit',
      sessionId: SESSION_ID,
      responseId: RESPONSE_ID,
      value: 67,
    });
  });

  it('lehnt voter:submit mit ungültigen Werten ab', () => {
    for (const value of [-1, 101, 12.5, '50', null, undefined]) {
      expect(
        parseClientMessage(
          JSON.stringify({ type: 'voter:submit', sessionId: SESSION_ID, responseId: RESPONSE_ID, value }),
        ),
      ).toBeNull();
    }
  });

  it('lehnt voter:submit mit ungültiger Session ab', () => {
    expect(
      parseClientMessage(
        JSON.stringify({ type: 'voter:submit', sessionId: '../../etc', responseId: RESPONSE_ID, value: 1 }),
      ),
    ).toBeNull();
  });

  it('erlaubt presenter:hello ohne Session', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'presenter:hello' }))).toEqual({
      type: 'presenter:hello',
    });
  });

  it('validiert presenter:set-results-visible', () => {
    expect(
      parseClientMessage(
        JSON.stringify({ type: 'presenter:set-results-visible', sessionId: SESSION_ID, visible: false }),
      ),
    ).toEqual({ type: 'presenter:set-results-visible', sessionId: SESSION_ID, visible: false });

    expect(
      parseClientMessage(
        JSON.stringify({ type: 'presenter:set-results-visible', sessionId: SESSION_ID, visible: 'ja' }),
      ),
    ).toBeNull();
  });
});

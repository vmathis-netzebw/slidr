import { describe, expect, it } from 'vitest';
import { exportDefinition, importDefinition } from '../client/lib/definitionFile.js';
import { alignResponses, parseAnswers, parseDefinition, responsesToCsv, summarize, type FeedbackDefinition, type FeedbackResponse } from './feedback.js';

const YAML_DEFINITION = `
title: Workshop-Feedback
questions:
  - type: scale
    title: Wie zufrieden warst du?
    required: true
  - type: single
    title: Tempo
    options: [zu langsam, passend, zu schnell]
  - type: multi
    id: topics
    title: Was war hilfreich?
    options: [Theorie, Übungen, Pausen]
  - type: slider
    title: Entwickeln oder Customizen?
    leftLabel: Entwickeln
    rightLabel: Customizen
  - type: text
    title: Sonst noch was?
    multiline: false
`;

function definition(): FeedbackDefinition {
  const result = importDefinition(YAML_DEFINITION);
  if (!result.ok) throw new Error(result.errors.join(', '));
  return result.value;
}

describe('parseDefinition', () => {
  it('liest YAML, ergänzt Defaults und vergibt fehlende IDs', () => {
    const def = definition();
    expect(def.version).toBe(1);
    expect(def.questions.map((q) => q.id)).toEqual(['q1', 'q2', 'topics', 'q3', 'q4']);
    expect(def.questions[0]).toMatchObject({ type: 'scale', min: 1, max: 5, required: true });
    expect(def.questions[4]).toMatchObject({ type: 'text', multiline: false, required: false });
  });

  it('übernimmt CI-Farben, ergänzt fehlende und lehnt ungültige ab', () => {
    const base = { title: 'T', questions: [{ type: 'text', title: 'X' }] };
    const ok = parseDefinition({ ...base, theme: { primary: '#E2001A', secondary: '#abc' } });
    expect(ok.ok && ok.value.theme).toEqual({ primary: '#e2001a', secondary: '#aabbcc', tertiary: '#ffd166' });
    const defaults = parseDefinition({ ...base, theme: { primary: '#2f6df6' } });
    expect(defaults.ok && defaults.value.theme).toBeUndefined();
    expect(parseDefinition({ ...base, theme: { primary: 'red; background:url(x)' } }).ok).toBe(false);
  });

  it('übersteht einen Export/Import-Roundtrip in JSON und YAML', () => {
    const def = definition();
    for (const format of ['json', 'yaml'] as const) {
      const again = importDefinition(exportDefinition(def, format));
      expect(again).toEqual({ ok: true, value: def });
    }
  });

  it('meldet verständliche Fehler', () => {
    const result = parseDefinition({
      title: '',
      questions: [
        { type: 'foo', title: 'x' },
        { type: 'single', title: 'y', options: ['nur eine'] },
        { type: 'scale', title: 'z', min: 5, max: 3 },
        { type: 'text', id: 'a', title: 'a' },
        { type: 'text', id: 'a', title: 'b' },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      'Titel fehlt.',
      expect.stringContaining('unbekannter Typ'),
      expect.stringContaining('mindestens zwei Antwortoptionen'),
      expect.stringContaining('"max" muss größer'),
      'Frage-ID "a" ist doppelt.',
    ]);
  });

  it('lehnt ungültiges YAML und falsche Versionen ab', () => {
    expect(importDefinition('title: [unclosed').ok).toBe(false);
    expect(parseDefinition({ version: 2, title: 't', questions: [{ type: 'text', title: 'x' }] }).ok).toBe(false);
  });
});

describe('parseAnswers', () => {
  it('akzeptiert gültige Antworten und lässt leere optionale weg', () => {
    const result = parseAnswers(definition(), { q1: 4, q2: 1, topics: [2, 0, 2], q3: 30, q4: '  ' });
    expect(result).toEqual({ ok: true, value: { q1: 4, q2: 1, topics: [0, 2], q3: 30 } });
  });

  it('erzwingt Pflichtfragen und Wertebereiche', () => {
    const def = definition();
    expect(parseAnswers(def, {}).ok).toBe(false);
    for (const bad of [{ q1: 6 }, { q1: 3, q2: 3 }, { q1: 3, topics: [5] }, { q1: 3, q3: 101 }, { q1: 3, q4: 7 }, { q1: 3, x: 1 }]) {
      expect(parseAnswers(def, bad).ok).toBe(false);
    }
  });
});

describe('Auswertung', () => {
  const def = definition();
  const responses: FeedbackResponse[] = [
    { submittedAt: 0, version: 1, answers: { q1: 5, q2: 1, topics: [0, 1], q4: '=SUMME(A1)' } },
    { submittedAt: 1000, version: 1, answers: { q1: 3, topics: [1], q3: 80, q4: 'Super; danke "!"' } },
  ];

  it('übernimmt alte Antworten nur für strukturell gleiche Fragen', () => {
    const next = parseDefinition({
      ...def,
      questions: def.questions.map((q) =>
        q.type === 'single' ? { ...q, options: ['A', 'B'] } : { ...q, title: `${q.title}?` },
      ),
    });
    if (!next.ok) throw new Error('ungültig');
    const aligned = alignResponses([{ version: 1, definition: def }, { version: 2, definition: next.value }], next.value, responses);
    expect(aligned[0]?.answers).toEqual({ q1: 5, topics: [0, 1], q4: '=SUMME(A1)' });
  });

  it('vergibt keine reservierten IDs', () => {
    const result = parseDefinition({ title: 'x', questions: [{ type: 'text', title: 'neu' }] }, new Set(['q1', 'q2']));
    expect(result.ok && result.value.questions[0]?.id).toBe('q3');
  });

  it('fasst Antworten pro Frage zusammen', () => {
    const [scale, single, multi, slider, text] = summarize(def, responses);
    expect(scale).toMatchObject({ answered: 2, counts: [0, 0, 1, 0, 1], average: 4 });
    expect(single).toMatchObject({ answered: 1, counts: [0, 1, 0] });
    expect(multi).toMatchObject({ answered: 2, counts: [1, 2, 0] });
    expect(slider).toMatchObject({ answered: 1 });
    expect(text).toMatchObject({ answered: 2, texts: ['=SUMME(A1)', 'Super; danke "!"'] });
  });

  it('erzeugt CSV mit Optionstexten und entschärft Formeln', () => {
    const lines = responsesToCsv(def, responses).split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe("1970-01-01T00:00:00.000Z;5;passend;Theorie, Übungen;;'=SUMME(A1)");
    expect(lines[2]).toContain('"Super; danke ""!"""');
  });
});

/**
 * Asynchrone Feedback-Bögen: Schema, Validierung und Auswertung.
 * Von Client (Editor, Import, Formular) und Server (Durchsetzung) gemeinsam genutzt.
 */
import { SESSION_ID_PATTERN, VALUE_MAX, VALUE_MIN, type SessionStats } from './protocol.js';
import { computeStats } from './stats.js';

export const FEEDBACK_FORMAT_VERSION = 1;
export const FEEDBACK_ID_PATTERN = SESSION_ID_PATTERN;

export const TITLE_MAX_LENGTH = 200;
export const DESCRIPTION_MAX_LENGTH = 2000;
export const QUESTION_TITLE_MAX_LENGTH = 300;
export const MAX_QUESTIONS = 50;
export const MAX_OPTIONS = 20;
export const OPTION_MAX_LENGTH = 120;
export const LABEL_MAX_LENGTH = 40;
export const TEXT_ANSWER_MAX_LENGTH = 4000;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;
export const MAX_FEEDBACK_RESPONSES = 10_000;

const QUESTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
const SCALE_LIMIT_MIN = 0;
const SCALE_LIMIT_MAX = 10;

export const QUESTION_TYPES = ['text', 'single', 'multi', 'scale', 'slider'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  text: 'Freitext',
  single: 'Einfachauswahl',
  multi: 'Mehrfachauswahl',
  scale: 'Skala (z.B. 1–5)',
  slider: 'Slider zwischen zwei Polen',
};

interface QuestionBase {
  id: string;
  title: string;
  description?: string;
  required: boolean;
}

export interface TextQuestion extends QuestionBase {
  type: 'text';
  multiline: boolean;
}

export interface ChoiceQuestion extends QuestionBase {
  type: 'single' | 'multi';
  options: string[];
}

export interface ScaleQuestion extends QuestionBase {
  type: 'scale';
  min: number;
  max: number;
  minLabel?: string;
  maxLabel?: string;
}

export interface SliderQuestion extends QuestionBase {
  type: 'slider';
  leftLabel: string;
  rightLabel: string;
}

export type Question = TextQuestion | ChoiceQuestion | ScaleQuestion | SliderQuestion;

export interface FeedbackDefinition {
  version: typeof FEEDBACK_FORMAT_VERSION;
  title: string;
  description?: string;
  questions: Question[];
}

/** text: string · single/scale/slider: number · multi: Options-Indizes */
export type AnswerValue = string | number | number[];
export type Answers = Record<string, AnswerValue>;

export interface FeedbackResponse {
  submittedAt: number;
  /** Gesetzt, wenn die Antwort nachträglich geändert wurde. */
  updatedAt?: number;
  /** Version der Definition, auf die sich die Antwort bezieht. */
  version: number;
  answers: Answers;
}

/** Öffentliche Sicht für Teilnehmende. */
export interface PublicFeedback {
  id: string;
  version: number;
  definition: FeedbackDefinition;
  closed: boolean;
}

export interface FeedbackVersion {
  version: number;
  createdAt: number;
  definition: FeedbackDefinition;
}

/** Sicht nach Passwort-Prüfung. */
export interface FeedbackAdminView extends PublicFeedback {
  createdAt: number;
  versions: FeedbackVersion[];
  responses: FeedbackResponse[];
}

/** Eigene Antwort eines Geräts (zum Ändern). */
export interface OwnResponse {
  version: number;
  answers: Answers;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/* ------------------------------ Definition ------------------------------- */

export function createQuestion(type: QuestionType, base: Partial<QuestionBase> = {}): Question {
  const common: QuestionBase = {
    id: base.id ?? '',
    title: base.title ?? '',
    required: base.required ?? false,
    ...(base.description ? { description: base.description } : {}),
  };
  switch (type) {
    case 'text':
      return { ...common, type, multiline: true };
    case 'single':
    case 'multi':
      return { ...common, type, options: ['', ''] };
    case 'scale':
      return { ...common, type, min: 1, max: 5, minLabel: 'gar nicht', maxLabel: 'sehr' };
    case 'slider':
      return { ...common, type, leftLabel: 'links', rightLabel: 'rechts' };
  }
}

/**
 * Prüft und normalisiert eine Definition aus beliebiger Quelle (Editor, JSON-/YAML-Import, API).
 * Fehlende Frage-IDs werden vergeben (nie aus `reservedIds`); Standardwerte werden ergänzt.
 */
export function parseDefinition(
  input: unknown,
  reservedIds: ReadonlySet<string> = new Set(),
): ParseResult<FeedbackDefinition> {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ['Die Definition muss ein Objekt sein.'] };

  if (input.version !== undefined && input.version !== FEEDBACK_FORMAT_VERSION) {
    errors.push(`Nicht unterstützte Version "${String(input.version)}" (erwartet ${FEEDBACK_FORMAT_VERSION}).`);
  }

  const title = singleLine(input.title, TITLE_MAX_LENGTH);
  if (!title) errors.push('Titel fehlt.');
  const description = multiLine(input.description, DESCRIPTION_MAX_LENGTH);

  const rawQuestions = input.questions;
  const questions: Question[] = [];
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    errors.push('Mindestens eine Frage ist nötig.');
  } else if (rawQuestions.length > MAX_QUESTIONS) {
    errors.push(`Höchstens ${MAX_QUESTIONS} Fragen erlaubt.`);
  } else {
    rawQuestions.forEach((raw, index) => {
      const result = parseQuestion(raw, `Frage ${index + 1}`);
      if (result.ok) questions.push(result.value);
      else errors.push(...result.errors);
    });
  }

  const seen = new Set<string>();
  for (const question of questions) {
    if (!question.id) continue;
    if (seen.has(question.id)) errors.push(`Frage-ID "${question.id}" ist doppelt.`);
    seen.add(question.id);
  }
  let counter = 1;
  for (const question of questions) {
    if (question.id) continue;
    while (seen.has(`q${counter}`) || reservedIds.has(`q${counter}`)) counter += 1;
    question.id = `q${counter}`;
    seen.add(question.id);
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      version: FEEDBACK_FORMAT_VERSION,
      title,
      ...(description ? { description } : {}),
      questions,
    },
  };
}

function parseQuestion(raw: unknown, label: string): ParseResult<Question> {
  if (!isRecord(raw)) return { ok: false, errors: [`${label}: muss ein Objekt sein.`] };
  const errors: string[] = [];

  const type = raw.type;
  if (typeof type !== 'string' || !(QUESTION_TYPES as readonly string[]).includes(type)) {
    return {
      ok: false,
      errors: [`${label}: unbekannter Typ "${String(type)}" (erlaubt: ${QUESTION_TYPES.join(', ')}).`],
    };
  }

  let id = '';
  if (raw.id !== undefined && raw.id !== null && raw.id !== '') {
    if (typeof raw.id !== 'string' || !QUESTION_ID_PATTERN.test(raw.id)) {
      errors.push(`${label}: ID darf nur Buchstaben, Ziffern, "-" und "_" enthalten (max. 40).`);
    } else {
      id = raw.id;
    }
  }

  const title = singleLine(raw.title, QUESTION_TITLE_MAX_LENGTH);
  if (!title) errors.push(`${label}: Fragetext fehlt.`);
  const description = multiLine(raw.description, DESCRIPTION_MAX_LENGTH);
  if (raw.required !== undefined && typeof raw.required !== 'boolean') {
    errors.push(`${label}: "required" muss true oder false sein.`);
  }
  const base: QuestionBase = {
    id,
    title,
    required: raw.required === true,
    ...(description ? { description } : {}),
  };

  let question: Question | null = null;
  switch (type as QuestionType) {
    case 'text':
      question = { ...base, type: 'text', multiline: raw.multiline !== false };
      break;

    case 'single':
    case 'multi': {
      if (!Array.isArray(raw.options)) {
        errors.push(`${label}: "options" muss eine Liste sein.`);
        break;
      }
      const options = raw.options
        .map((option) => singleLine(typeof option === 'number' ? String(option) : option, OPTION_MAX_LENGTH))
        .filter((option) => option.length > 0);
      if (options.length < 2) errors.push(`${label}: mindestens zwei Antwortoptionen nötig.`);
      if (options.length > MAX_OPTIONS) errors.push(`${label}: höchstens ${MAX_OPTIONS} Antwortoptionen.`);
      if (new Set(options).size !== options.length) errors.push(`${label}: Antwortoptionen sind doppelt.`);
      question = { ...base, type: type as 'single' | 'multi', options };
      break;
    }

    case 'scale': {
      const min = raw.min ?? 1;
      const max = raw.max ?? 5;
      if (!isIntIn(min, SCALE_LIMIT_MIN, SCALE_LIMIT_MAX) || !isIntIn(max, SCALE_LIMIT_MIN, SCALE_LIMIT_MAX)) {
        errors.push(`${label}: "min" und "max" müssen ganze Zahlen von ${SCALE_LIMIT_MIN} bis ${SCALE_LIMIT_MAX} sein.`);
        break;
      }
      if (max - min < 1) {
        errors.push(`${label}: "max" muss größer als "min" sein.`);
        break;
      }
      const minLabel = singleLine(raw.minLabel, LABEL_MAX_LENGTH);
      const maxLabel = singleLine(raw.maxLabel, LABEL_MAX_LENGTH);
      question = {
        ...base,
        type: 'scale',
        min,
        max,
        ...(minLabel ? { minLabel } : {}),
        ...(maxLabel ? { maxLabel } : {}),
      };
      break;
    }

    case 'slider': {
      const leftLabel = singleLine(raw.leftLabel, LABEL_MAX_LENGTH);
      const rightLabel = singleLine(raw.rightLabel, LABEL_MAX_LENGTH);
      if (!leftLabel || !rightLabel) errors.push(`${label}: "leftLabel" und "rightLabel" sind nötig.`);
      question = { ...base, type: 'slider', leftLabel, rightLabel };
      break;
    }
  }

  if (errors.length > 0 || !question) return { ok: false, errors };
  return { ok: true, value: question };
}

/* -------------------------------- Antworten -------------------------------- */

/** Prüft Antworten gegen die Definition. Leere/fehlende Antworten auf optionale Fragen werden weggelassen. */
export function parseAnswers(definition: FeedbackDefinition, input: unknown): ParseResult<Answers> {
  if (!isRecord(input)) return { ok: false, errors: ['Antworten fehlen.'] };
  const errors: string[] = [];
  const answers: Answers = {};
  const known = new Set(definition.questions.map((q) => q.id));
  for (const key of Object.keys(input)) {
    if (!known.has(key)) errors.push(`Unbekannte Frage "${key}".`);
  }

  for (const question of definition.questions) {
    const raw = input[question.id];
    const result = parseAnswer(question, raw);
    if (result === INVALID) {
      errors.push(`"${question.title}": ungültige Antwort.`);
    } else if (result === undefined) {
      if (question.required) errors.push(`"${question.title}" ist eine Pflichtfrage.`);
    } else {
      answers[question.id] = result;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: answers };
}

/** Behält nur Antworten, die zur (evtl. geänderten) Definition noch passen. */
export function sanitizeAnswers(definition: FeedbackDefinition, answers: Answers): Answers {
  const result: Answers = {};
  for (const question of definition.questions) {
    const value = parseAnswer(question, answers[question.id]);
    if (value !== undefined && value !== INVALID) result[question.id] = value;
  }
  return result;
}

const INVALID = Symbol('invalid');

function parseAnswer(question: Question, raw: unknown): AnswerValue | undefined | typeof INVALID {
  if (raw === undefined || raw === null) return undefined;
  switch (question.type) {
    case 'text': {
      if (typeof raw !== 'string') return INVALID;
      const text = raw.replace(/\r\n?/g, '\n').trim();
      if (text.length > TEXT_ANSWER_MAX_LENGTH) return INVALID;
      return text.length > 0 ? text : undefined;
    }
    case 'single':
      return isIntIn(raw, 0, question.options.length - 1) ? raw : INVALID;
    case 'multi': {
      if (!Array.isArray(raw)) return INVALID;
      if (!raw.every((i) => isIntIn(i, 0, question.options.length - 1))) return INVALID;
      const unique = [...new Set(raw as number[])].sort((a, b) => a - b);
      return unique.length > 0 ? unique : undefined;
    }
    case 'scale':
      return isIntIn(raw, question.min, question.max) ? raw : INVALID;
    case 'slider':
      return isIntIn(raw, VALUE_MIN, VALUE_MAX) ? raw : INVALID;
  }
}

/* ------------------------------- Auswertung -------------------------------- */

export type QuestionSummary =
  | { type: 'text'; question: TextQuestion; answered: number; texts: string[] }
  | { type: 'single' | 'multi'; question: ChoiceQuestion; answered: number; counts: number[] }
  | { type: 'scale'; question: ScaleQuestion; answered: number; counts: number[]; average: number | null }
  | { type: 'slider'; question: SliderQuestion; answered: number; stats: SessionStats };

export function summarize(definition: FeedbackDefinition, responses: FeedbackResponse[]): QuestionSummary[] {
  return definition.questions.map((question): QuestionSummary => {
    const values = responses
      .map((response) => response.answers[question.id])
      .filter((value): value is AnswerValue => value !== undefined);

    switch (question.type) {
      case 'text':
        return {
          type: 'text',
          question,
          answered: values.length,
          texts: values.filter((v): v is string => typeof v === 'string'),
        };
      case 'single':
      case 'multi': {
        const counts = question.options.map(() => 0);
        for (const value of values) {
          for (const index of Array.isArray(value) ? value : [value]) {
            if (typeof index === 'number' && index in counts) counts[index] = (counts[index] ?? 0) + 1;
          }
        }
        return { type: question.type, question, answered: values.length, counts };
      }
      case 'scale': {
        const numbers = values.filter((v): v is number => typeof v === 'number');
        const counts = Array.from({ length: question.max - question.min + 1 }, () => 0);
        for (const n of numbers) {
          const index = n - question.min;
          if (index in counts) counts[index] = (counts[index] ?? 0) + 1;
        }
        const average = numbers.length > 0 ? numbers.reduce((a, b) => a + b, 0) / numbers.length : null;
        return { type: 'scale', question, answered: numbers.length, counts, average };
      }
      case 'slider': {
        const numbers = values.filter((v): v is number => typeof v === 'number');
        return { type: 'slider', question, answered: numbers.length, stats: computeStats(numbers) };
      }
    }
  });
}

/**
 * Bildet Antworten aus beliebigen Versionen auf `target` ab. Eine Antwort zählt für eine Frage nur,
 * wenn die Frage in der Version der Antwort strukturell gleich war (Text-Korrekturen sind erlaubt,
 * geänderte Optionen/Skalen nicht, weil Indizes und Werte sonst etwas anderes bedeuten würden).
 */
export function alignResponses(
  versions: { version: number; definition: FeedbackDefinition }[],
  target: FeedbackDefinition,
  responses: FeedbackResponse[],
): FeedbackResponse[] {
  const structure = (q: Question): string => {
    const { title: _t, description: _d, required: _r, ...rest } = q;
    return JSON.stringify(rest);
  };
  const targetStructure = new Map(target.questions.map((q) => [q.id, structure(q)]));
  const compatibleByVersion = new Map(
    versions.map((v) => [
      v.version,
      new Set(v.definition.questions.filter((q) => targetStructure.get(q.id) === structure(q)).map((q) => q.id)),
    ]),
  );
  return responses.map((response) => {
    const compatible = compatibleByVersion.get(response.version);
    const answers: Answers = {};
    for (const [key, value] of Object.entries(response.answers)) {
      if (compatible?.has(key)) answers[key] = value;
    }
    return { ...response, answers };
  });
}

/** CSV (Semikolon-getrennt, für Excel DE) mit einer Zeile pro Antwort. */
export function responsesToCsv(definition: FeedbackDefinition, responses: FeedbackResponse[]): string {
  const header = ['Zeitpunkt', ...definition.questions.map((q) => q.title)];
  const rows = responses.map((response) => [
    new Date(response.submittedAt).toISOString(),
    ...definition.questions.map((q) => formatAnswer(q, response.answers[q.id])),
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n');
}

export function formatAnswer(question: Question, value: AnswerValue | undefined): string {
  if (value === undefined) return '';
  switch (question.type) {
    case 'single':
      return typeof value === 'number' ? (question.options[value] ?? '') : '';
    case 'multi':
      return Array.isArray(value) ? value.map((i) => question.options[i] ?? '').join(', ') : '';
    default:
      return String(value);
  }
}

function csvCell(value: string): string {
  // Formel-Injection in Tabellenkalkulationen verhindern.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/* --------------------------------- Helfer ---------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIntIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function singleLine(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function multiLine(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n?/g, '\n').trim().slice(0, maxLength);
}

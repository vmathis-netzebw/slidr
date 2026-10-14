import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  FEEDBACK_FORMAT_VERSION,
  MAX_QUESTIONS,
  PASSWORD_MIN_LENGTH,
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  createQuestion,
  parseDefinition,
  type FeedbackDefinition,
  type PublicFeedback,
  type Question,
  type QuestionType,
} from '../../shared/feedback.js';
import { QrCode } from '../components/QrCode.js';
import { downloadDefinition, importDefinition, type DefinitionFormat } from '../lib/definitionFile.js';
import { ApiError, feedbackApi, feedbackUrlFor, resultsUrlFor } from '../lib/feedbackApi.js';
import { fetchPublicOrigin } from '../lib/publicUrl.js';

const DRAFT_STORAGE_KEY = 'live-poll:feedback-draft';

type DraftQuestion = Question & { key: string };

interface Draft {
  title: string;
  description: string;
  questions: DraftQuestion[];
}

let keyCounter = 0;
const nextKey = (): string => `k${(keyCounter += 1)}`;

function draftFrom(definition: FeedbackDefinition): Draft {
  return {
    title: definition.title,
    description: definition.description ?? '',
    questions: definition.questions.map((q) => ({ ...q, key: nextKey() })),
  };
}

function emptyDraft(): Draft {
  return {
    title: '',
    description: '',
    questions: [{ ...createQuestion('scale', { title: 'Wie zufrieden warst du insgesamt?', required: true }), key: nextKey() }],
  };
}

function loadDraft(): Draft {
  try {
    const stored = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Draft;
      if (Array.isArray(parsed.questions)) {
        return { ...parsed, questions: parsed.questions.map((q) => ({ ...q, key: nextKey() })) };
      }
    }
  } catch {
    // Kaputter Entwurf -> neu beginnen
  }
  return emptyDraft();
}

function toDefinitionInput(draft: Draft): unknown {
  return {
    version: FEEDBACK_FORMAT_VERSION,
    title: draft.title,
    description: draft.description,
    questions: draft.questions,
  };
}

export interface EditTarget {
  id: string;
  password: string;
  definition: FeedbackDefinition;
  hasResponses: boolean;
  onSaved: (feedback: PublicFeedback) => void;
  onCancel: () => void;
}

export function FeedbackCreatePage({ edit }: { edit?: EditTarget }): JSX.Element {
  const [draft, setDraft] = useState<Draft>(() => (edit ? draftFrom(edit.definition) : loadDraft()));
  const [password, setPassword] = useState('');
  const [passwordRepeat, setPasswordRepeat] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<PublicFeedback | null>(null);
  const [origin, setOrigin] = useState(() => window.location.origin);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchPublicOrigin(controller.signal).then(setOrigin).catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (edit) return;
    try {
      window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      // Speicher voll / blockiert – Entwurf geht beim Reload verloren.
    }
  }, [draft, edit]);

  const updateQuestion = (key: string, patch: Partial<Question>): void => {
    setDraft((d) => ({
      ...d,
      questions: d.questions.map((q) => (q.key === key ? ({ ...q, ...patch } as DraftQuestion) : q)),
    }));
  };

  const changeType = (key: string, type: QuestionType): void => {
    setDraft((d) => ({
      ...d,
      questions: d.questions.map((q) => (q.key === key ? { ...createQuestion(type, q), key } : q)),
    }));
  };

  const moveQuestion = (index: number, delta: number): void => {
    setDraft((d) => {
      const questions = [...d.questions];
      const target = index + delta;
      const [item] = questions.splice(index, 1);
      if (!item || target < 0 || target > questions.length) return d;
      questions.splice(target, 0, item);
      return { ...d, questions };
    });
  };

  const removeQuestion = (key: string): void => {
    setDraft((d) => ({ ...d, questions: d.questions.filter((q) => q.key !== key) }));
  };

  const addQuestion = (type: QuestionType): void => {
    setDraft((d) => ({ ...d, questions: [...d.questions, { ...createQuestion(type), key: nextKey() }] }));
  };

  const validate = (): FeedbackDefinition | null => {
    const result = parseDefinition(toDefinitionInput(draft));
    if (!result.ok) {
      setErrors(result.errors);
      return null;
    }
    setErrors([]);
    return result.value;
  };

  const exportAs = (format: DefinitionFormat): void => {
    const definition = validate();
    if (definition) downloadDefinition(definition, format);
  };

  const onImport = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 256 * 1024) {
      setErrors(['Datei ist zu groß (max. 256 KB).']);
      return;
    }
    const result = importDefinition(await file.text());
    if (!result.ok) {
      setErrors(result.errors);
      setNotice(null);
      return;
    }
    setDraft(draftFrom(result.value));
    setErrors([]);
    setNotice(`"${file.name}" importiert: ${result.value.questions.length} Fragen.`);
  };

  const submit = async (): Promise<void> => {
    const definition = validate();
    if (!definition) return;
    if (edit) {
      setBusy(true);
      try {
        // Rohentwurf senden: Der Server vergibt IDs neuer Fragen ohne Kollision mit früheren Versionen.
        edit.onSaved(await feedbackApi.update(edit.id, edit.password, toDefinitionInput(draft)));
      } catch (error) {
        setErrors(error instanceof ApiError ? [error.message, ...error.details] : ['Server nicht erreichbar.']);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      setErrors([`Das Passwort muss mindestens ${PASSWORD_MIN_LENGTH} Zeichen lang sein.`]);
      return;
    }
    if (password !== passwordRepeat) {
      setErrors(['Die Passwörter stimmen nicht überein.']);
      return;
    }
    setBusy(true);
    try {
      setCreated(await feedbackApi.create(definition, password));
      setErrors([]);
    } catch (error) {
      setErrors(error instanceof ApiError ? [error.message, ...error.details] : ['Server nicht erreichbar.']);
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    const respondUrl = feedbackUrlFor(origin, created.id);
    const resultsUrl = resultsUrlFor(origin, created.id);
    return (
      <main className="page">
        <h1>Feedback-Bogen erstellt</h1>
        <p className="page__lead">{created.definition.title}</p>
        <div className="created">
          <QrCode value={respondUrl} size={260} />
          <dl className="created__links">
            <dt>Link für Teilnehmende</dt>
            <dd>
              <a href={respondUrl}>{respondUrl}</a>
            </dd>
            <dt>Ergebnisse (passwortgeschützt)</dt>
            <dd>
              <a href={resultsUrl}>{resultsUrl}</a>
            </dd>
          </dl>
        </div>
        <p className="notice notice--warn">
          Merke dir das Passwort. Es wird nur als Hash gespeichert und kann nicht wiederhergestellt werden.
        </p>
        <div className="row">
          <button
            type="button"
            className="button"
            onClick={() => {
              setCreated(null);
              setPassword('');
              setPasswordRepeat('');
            }}
          >
            Weiteren Bogen erstellen
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="page__header">
        <h1>{edit ? 'Fragen bearbeiten' : 'Feedback-Bogen erstellen'}</h1>
        <div className="row">
          <input
            ref={fileInput}
            type="file"
            accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml"
            hidden
            onChange={(e) => void onImport(e)}
          />
          <button type="button" className="button" onClick={() => fileInput.current?.click()}>
            Importieren (JSON/YAML)
          </button>
          <button type="button" className="button" onClick={() => exportAs('json')}>
            Export JSON
          </button>
          <button type="button" className="button" onClick={() => exportAs('yaml')}>
            Export YAML
          </button>
          {edit ? null : (
            <button
              type="button"
              className="button"
              onClick={() => {
                if (window.confirm('Entwurf verwerfen?')) setDraft(emptyDraft());
              }}
            >
              Leeren
            </button>
          )}
        </div>
      </header>

      {edit?.hasResponses ? (
        <p className="notice notice--warn">
          Speichern erzeugt eine neue Version. Bisherige Antworten bleiben erhalten und zählen weiter für Fragen,
          deren Typ und Optionen gleich bleiben. Textkorrekturen sind unkritisch; geänderte Optionen oder Skalen
          werden in der Auswertung getrennt geführt.
        </p>
      ) : null}
      {notice ? <p className="notice">{notice}</p> : null}

      <section className="card">
        <label className="field">
          <span>Titel</span>
          <input
            className="input"
            value={draft.title}
            maxLength={200}
            placeholder="z.B. Feedback zum Workshop"
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          />
        </label>
        <label className="field">
          <span>Beschreibung (optional)</span>
          <textarea
            className="input"
            rows={2}
            value={draft.description}
            maxLength={2000}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          />
        </label>
      </section>

      {draft.questions.map((question, index) => (
        <QuestionEditor
          key={question.key}
          index={index}
          total={draft.questions.length}
          question={question}
          onChange={(patch) => updateQuestion(question.key, patch)}
          onChangeType={(type) => changeType(question.key, type)}
          onMove={(delta) => moveQuestion(index, delta)}
          onRemove={() => removeQuestion(question.key)}
        />
      ))}

      <section className="card card--dashed">
        <span className="field__hint">Frage hinzufügen:</span>
        <div className="row">
          {QUESTION_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              className="button"
              disabled={draft.questions.length >= MAX_QUESTIONS}
              onClick={() => addQuestion(type)}
            >
              + {QUESTION_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      </section>

      {edit ? null : (
      <section className="card">
        <h2>Ergebnisse schützen</h2>
        <div className="grid2">
          <label className="field">
            <span>Passwort (min. {PASSWORD_MIN_LENGTH} Zeichen)</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Passwort wiederholen</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={passwordRepeat}
              onChange={(e) => setPasswordRepeat(e.target.value)}
            />
          </label>
        </div>
      </section>
      )}

      {errors.length > 0 ? (
        <ul className="notice notice--error">
          {errors.map((error, i) => (
            <li key={i}>{error}</li>
          ))}
        </ul>
      ) : null}

      <div className="row">
        <button type="button" className="button button--primary button--large" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Speichere …' : edit ? 'Änderungen speichern' : 'Feedback-Bogen veröffentlichen'}
        </button>
        {edit ? (
          <button type="button" className="button button--large" disabled={busy} onClick={edit.onCancel}>
            Abbrechen
          </button>
        ) : null}
      </div>
    </main>
  );
}

interface QuestionEditorProps {
  index: number;
  total: number;
  question: DraftQuestion;
  onChange: (patch: Partial<Question>) => void;
  onChangeType: (type: QuestionType) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}

function QuestionEditor({ index, total, question, onChange, onChangeType, onMove, onRemove }: QuestionEditorProps): JSX.Element {
  return (
    <section className="card">
      <div className="card__head">
        <strong>Frage {index + 1}</strong>
        <select
          className="input input--inline"
          value={question.type}
          onChange={(e) => onChangeType(e.target.value as QuestionType)}
        >
          {QUESTION_TYPES.map((type) => (
            <option key={type} value={type}>
              {QUESTION_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={question.required} onChange={(e) => onChange({ required: e.target.checked })} />
          Pflichtfrage
        </label>
        <span className="card__spacer" />
        <button type="button" className="icon-button" aria-label="Nach oben" disabled={index === 0} onClick={() => onMove(-1)}>
          ↑
        </button>
        <button type="button" className="icon-button" aria-label="Nach unten" disabled={index === total - 1} onClick={() => onMove(1)}>
          ↓
        </button>
        <button type="button" className="icon-button" aria-label="Frage entfernen" onClick={onRemove}>
          ✕
        </button>
      </div>

      <label className="field">
        <span>Fragetext</span>
        <input className="input" value={question.title} maxLength={300} onChange={(e) => onChange({ title: e.target.value })} />
      </label>
      <label className="field">
        <span>Hinweis (optional)</span>
        <input
          className="input"
          value={question.description ?? ''}
          maxLength={2000}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </label>

      {question.type === 'text' ? (
        <label className="check">
          <input type="checkbox" checked={question.multiline} onChange={(e) => onChange({ multiline: e.target.checked })} />
          Mehrzeilige Antwort
        </label>
      ) : null}

      {question.type === 'single' || question.type === 'multi' ? (
        <label className="field">
          <span>Antwortoptionen (eine pro Zeile)</span>
          <textarea
            className="input"
            rows={Math.max(3, question.options.length)}
            value={question.options.join('\n')}
            onChange={(e) => onChange({ options: e.target.value.split('\n') })}
          />
        </label>
      ) : null}

      {question.type === 'scale' ? (
        <div className="grid4">
          <label className="field">
            <span>Von</span>
            <input
              className="input"
              type="number"
              min={0}
              max={9}
              value={question.min}
              onChange={(e) => onChange({ min: Number.parseInt(e.target.value, 10) || 0 })}
            />
          </label>
          <label className="field">
            <span>Bis</span>
            <input
              className="input"
              type="number"
              min={1}
              max={10}
              value={question.max}
              onChange={(e) => onChange({ max: Number.parseInt(e.target.value, 10) || 0 })}
            />
          </label>
          <label className="field">
            <span>Beschriftung unten</span>
            <input className="input" maxLength={40} value={question.minLabel ?? ''} onChange={(e) => onChange({ minLabel: e.target.value })} />
          </label>
          <label className="field">
            <span>Beschriftung oben</span>
            <input className="input" maxLength={40} value={question.maxLabel ?? ''} onChange={(e) => onChange({ maxLabel: e.target.value })} />
          </label>
        </div>
      ) : null}

      {question.type === 'slider' ? (
        <div className="grid2">
          <label className="field">
            <span>Linker Pol (0)</span>
            <input className="input" maxLength={40} value={question.leftLabel} onChange={(e) => onChange({ leftLabel: e.target.value })} />
          </label>
          <label className="field">
            <span>Rechter Pol (100)</span>
            <input className="input" maxLength={40} value={question.rightLabel} onChange={(e) => onChange({ rightLabel: e.target.value })} />
          </label>
        </div>
      ) : null}
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  TEXT_ANSWER_MAX_LENGTH,
  parseAnswers,
  sanitizeAnswers,
  type AnswerValue,
  type Answers,
  type PublicFeedback,
  type Question,
} from '../../shared/feedback.js';
import { ApiError, feedbackApi } from '../lib/feedbackApi.js';
import { getOrCreateResponseId } from '../lib/responseId.js';
import { themeStyle } from '../lib/themeStyle.js';
import { Logo } from '../components/Logo.js';

/** Kurz warten, damit die Auswahl sichtbar ist, bevor die nächste Frage kommt. */
const AUTO_ADVANCE_MS = 350;

export function FeedbackRespondPage({ feedbackId }: { feedbackId: string }): JSX.Element {
  // Pro Gerät eine Antwort je Bogen; dieselbe ID erlaubt späteres Ändern.
  const responseId = useMemo(() => getOrCreateResponseId(`F${feedbackId}`), [feedbackId]);
  const [feedback, setFeedback] = useState<PublicFeedback | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [hasOwn, setHasOwn] = useState(false);
  const [done, setDone] = useState(false);
  const [step, setStep] = useState(0);
  const advanceTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(advanceTimer.current), []);

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        const loaded = await feedbackApi.get(feedbackId);
        const own = await feedbackApi.mine(feedbackId, responseId).catch(() => null);
        setFeedback(loaded);
        if (own) {
          setAnswers(sanitizeAnswers(loaded.definition, own.answers));
          setHasOwn(true);
          setDone(true);
        }
      } catch (error) {
        setLoadError(error instanceof ApiError ? error.message : 'Server nicht erreichbar.');
      }
    };
    void load();
  }, [feedbackId, responseId]);

  const questions = feedback?.definition.questions ?? [];
  const current = Math.min(step, Math.max(0, questions.length - 1));
  const isLast = current >= questions.length - 1;

  const goTo = (index: number): void => {
    window.clearTimeout(advanceTimer.current);
    setErrors([]);
    setStep(Math.max(0, Math.min(index, questions.length - 1)));
  };

  const next = (): void => {
    const question = questions[current];
    if (question?.required && answers[question.id] === undefined) {
      setErrors([`"${question.title}" ist eine Pflichtfrage.`]);
      return;
    }
    goTo(current + 1);
  };

  const setAnswer = (questionId: string, value: AnswerValue | undefined, advance = false): void => {
    window.clearTimeout(advanceTimer.current);
    if (advance && value !== undefined && !isLast) {
      advanceTimer.current = window.setTimeout(() => goTo(current + 1), AUTO_ADVANCE_MS);
    }
    setErrors([]);
    setAnswers((current) => {
      const next = { ...current };
      if (value === undefined) delete next[questionId];
      else next[questionId] = value;
      return next;
    });
  };

  const submit = async (): Promise<void> => {
    if (!feedback) return;
    const parsed = parseAnswers(feedback.definition, answers);
    if (!parsed.ok) {
      const missing = feedback.definition.questions.findIndex((q) => q.required && answers[q.id] === undefined);
      if (missing >= 0) setStep(missing);
      setErrors(parsed.errors);
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      await feedbackApi.submit(feedbackId, responseId, feedback.version, parsed.value);
      setHasOwn(true);
      setDone(true);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // Fragen wurden geändert: neue Version laden, passende Antworten behalten.
        const fresh = await feedbackApi.get(feedbackId).catch(() => null);
        if (fresh) {
          setFeedback(fresh);
          setAnswers((current) => sanitizeAnswers(fresh.definition, current));
        }
      }
      setErrors(error instanceof ApiError ? [error.message, ...error.details] : ['Server nicht erreichbar.']);
    } finally {
      setBusy(false);
    }
  };

  const style = themeStyle(feedback?.definition.theme);

  if (done) {
    return (
      <main className="voter voter--message" style={style}>
        <div className="voter__done" aria-hidden="true">
          ✓
        </div>
        <h1>Danke für dein Feedback!</h1>
        {feedback && !feedback.closed ? (
          <button
            type="button"
            className="button"
            onClick={() => {
              setStep(0);
              setDone(false);
            }}
          >
            Antwort ändern
          </button>
        ) : null}
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="voter voter--message" style={style}>
        <h1>Feedback nicht verfügbar</h1>
        <p>{loadError}</p>
      </main>
    );
  }

  if (!feedback) {
    return (
      <main className="voter voter--message" style={style}>
        <p className="voter__status">Lade …</p>
      </main>
    );
  }

  if (feedback.closed) {
    return (
      <main className="voter voter--message" style={style}>
        <h1>{feedback.definition.title}</h1>
        <p>Dieser Feedback-Bogen ist geschlossen.</p>
      </main>
    );
  }

  const { definition } = feedback;
  const question = questions[current];
  return (
    <main className="page page--form" style={style}>
      <Logo theme={definition.theme} className="logo--page" />
      <h1>{definition.title}</h1>
      {definition.description && current === 0 ? (
        <p className="page__lead page__pre">{definition.description}</p>
      ) : null}

      <div className="stepper">
        <span className="stepper__label">
          Frage {current + 1} von {questions.length}
        </span>
        <div
          className="stepper__track"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={questions.length}
          aria-valuenow={current + 1}
        >
          <span className="stepper__fill" style={{ width: `${((current + 1) / questions.length) * 100}%` }} />
        </div>
      </div>

      {question ? (
        <fieldset key={question.id} className="card question">
          <legend className="question__title">
            {current + 1}. {question.title}
            {question.required ? <span className="question__required"> *</span> : null}
          </legend>
          {question.description ? <p className="field__hint page__pre">{question.description}</p> : null}
          <AnswerInput
            question={question}
            value={answers[question.id]}
            onChange={(v) => setAnswer(question.id, v, question.type === 'single' || question.type === 'scale')}
          />
        </fieldset>
      ) : null}

      <div className="stepper__nav">
        <button
          type="button"
          className="button stepper__arrow"
          aria-label="Vorherige Frage"
          disabled={current === 0}
          onClick={() => goTo(current - 1)}
        >
          ←
        </button>
        {isLast ? (
          <button type="button" className="button button--primary stepper__submit" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Sende …' : hasOwn ? 'Antwort aktualisieren' : 'Feedback absenden'}
          </button>
        ) : (
          <button
            type="button"
            className="button button--primary stepper__arrow"
            aria-label="Nächste Frage"
            onClick={next}
          >
            →
          </button>
        )}
      </div>

      {errors.length > 0 ? (
        <ul className="notice notice--error" role="alert">
          {errors.map((error, i) => (
            <li key={i}>{error}</li>
          ))}
        </ul>
      ) : null}

      <p className="field__hint">* Pflichtfrage · Antworten werden anonym gespeichert.</p>
    </main>
  );
}

interface AnswerInputProps {
  question: Question;
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue | undefined) => void;
}

function AnswerInput({ question, value, onChange }: AnswerInputProps): JSX.Element {
  switch (question.type) {
    case 'text':
      return question.multiline ? (
        <textarea
          className="input"
          rows={4}
          maxLength={TEXT_ANSWER_MAX_LENGTH}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      ) : (
        <input
          className="input"
          maxLength={TEXT_ANSWER_MAX_LENGTH}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );

    case 'single':
      return (
        <div className="choices">
          {question.options.map((option, i) => (
            <label key={i} className="choice">
              <input type="radio" name={question.id} checked={value === i} onChange={() => onChange(i)} />
              {option}
            </label>
          ))}
          {!question.required && value !== undefined ? (
            <button type="button" className="link-button" onClick={() => onChange(undefined)}>
              Auswahl zurücknehmen
            </button>
          ) : null}
        </div>
      );

    case 'multi': {
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="choices">
          {question.options.map((option, i) => (
            <label key={i} className="choice">
              <input
                type="checkbox"
                checked={selected.includes(i)}
                onChange={(e) => {
                  const next = e.target.checked ? [...selected, i] : selected.filter((s) => s !== i);
                  onChange(next.length > 0 ? next.sort((a, b) => a - b) : undefined);
                }}
              />
              {option}
            </label>
          ))}
        </div>
      );
    }

    case 'scale': {
      const steps = Array.from({ length: question.max - question.min + 1 }, (_, i) => question.min + i);
      return (
        <div className="scale">
          <div className="scale__buttons" role="radiogroup">
            {steps.map((step) => (
              <button
                key={step}
                type="button"
                role="radio"
                aria-checked={value === step}
                className={`scale__step${value === step ? ' scale__step--active' : ''}`}
                onClick={() => onChange(value === step && !question.required ? undefined : step)}
              >
                {step}
              </button>
            ))}
          </div>
          <div className="scale__labels">
            <span>{question.minLabel}</span>
            <span>{question.maxLabel}</span>
          </div>
        </div>
      );
    }

    case 'slider': {
      const touched = typeof value === 'number';
      return (
        <div className="voter__slider">
          <div className="question__slider-value">{touched ? value : '–'}</div>
          <input
            className={`slider${touched ? '' : ' slider--untouched'}`}
            type="range"
            min={0}
            max={100}
            step={1}
            value={touched ? value : 50}
            onChange={(e) => onChange(Number.parseInt(e.target.value, 10))}
            onClick={(e) => {
              if (!touched) onChange(Number.parseInt(e.currentTarget.value, 10));
            }}
          />
          <div className="voter__scale">
            <span className="voter__pole">{question.leftLabel}</span>
            <span className="voter__pole voter__pole--right">{question.rightLabel}</span>
          </div>
        </div>
      );
    }
  }
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_LEFT_LABEL,
  DEFAULT_RIGHT_LABEL,
  VALUE_MAX,
  VALUE_MIN,
  VALUE_STEP,
  type ServerMessage,
  type VoterSessionState,
} from '../../shared/protocol.js';
import { getOrCreateResponseId } from '../lib/responseId.js';
import { usePollSocket, type SendMessage } from '../lib/usePollSocket.js';

interface VotePageProps {
  sessionId: string;
}

export function VotePage({ sessionId }: VotePageProps): JSX.Element {
  const responseId = useMemo(() => getOrCreateResponseId(sessionId), [sessionId]);
  const [state, setState] = useState<VoterSessionState | null>(null);
  const [value, setValue] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);
  /** Absoluter Ablaufzeitpunkt aus der Server-Restzeit – unabhängig von der Uhr des Geräts. */
  const deadlineRef = useRef<number | null>(null);

  const handleMessage = useCallback((message: ServerMessage) => {
    switch (message.type) {
      case 'voter:state':
        setState(message.state);
        if (message.state.value !== null) setValue(message.state.value);
        if (message.state.hasVoted) setError(null);
        deadlineRef.current = message.state.hasVoted
          ? Date.now() + message.state.editableForMs
          : null;
        setRemainingMs(message.state.hasVoted ? message.state.editableForMs : 0);
        setSubmitting(false);
        setEditing(false);
        break;
      case 'voter:accepted':
        setValue(message.value);
        setSubmitting(false);
        setError(null);
        setEditing(false);
        break;
      case 'error':
        setSubmitting(false);
        setError(message.message);
        break;
      case 'presenter:state':
        break;
    }
  }, []);

  const handleOpen = useCallback(
    (send: SendMessage) => {
      send({ type: 'voter:hello', sessionId, responseId });
    },
    [sessionId, responseId],
  );

  const { status, send } = usePollSocket(handleMessage, handleOpen);

  const hasVoted = state?.hasVoted ?? false;

  useEffect(() => {
    if (deadlineRef.current === null) return;
    const tick = (): void => {
      const deadline = deadlineRef.current;
      const left = deadline === null ? 0 : Math.max(0, deadline - Date.now());
      setRemainingMs(left);
      if (left === 0) setEditing(false);
    };
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [hasVoted, state?.value]);

  const canEdit = hasVoted && remainingMs > 0;
  const locked = (hasVoted && !editing) || (state?.full ?? false);

  const submit = (): void => {
    if (locked || submitting) return;
    setSubmitting(true);
    setError(null);
    send({ type: 'voter:submit', sessionId, responseId, value });
  };

  if (status === 'connecting' && !state) {
    return (
      <main className="voter voter--message">
        <p className="voter__status">Verbinde …</p>
      </main>
    );
  }

  if (!state && error) {
    return (
      <main className="voter voter--message">
        <h1>Umfrage nicht verfügbar</h1>
        <p>{error}</p>
      </main>
    );
  }

  if (hasVoted && !editing) {
    return (
      <main className="voter voter--message">
        <div className="voter__done" aria-hidden="true">
          ✓
        </div>
        <h1>Antwort gespeichert.</h1>
        <p className="voter__done-value">{state?.value ?? value}</p>
        {canEdit ? (
          <>
            <button
              type="button"
              className="button button--large"
              onClick={() => setEditing(true)}
              disabled={status !== 'open'}
            >
              Antwort ändern
            </button>
            <p className="voter__hint" aria-live="polite">
              Noch {formatCountdown(remainingMs)} änderbar.
            </p>
          </>
        ) : (
          <p className="voter__hint">Du kannst dein Smartphone jetzt weglegen.</p>
        )}
        {error ? <p className="voter__error">{error}</p> : null}
      </main>
    );
  }

  if (state?.full) {
    return (
      <main className="voter voter--message">
        <h1>Umfrage geschlossen</h1>
        <p>Es werden keine weiteren Antworten angenommen.</p>
      </main>
    );
  }

  return (
    <main className="voter">
      <h1 className="voter__question">{state?.question ?? 'Umfrage'}</h1>

      <div className="voter__value" aria-live="polite">
        {value}
      </div>

      <div className="voter__slider">
        <div className="voter__scale">
          <span className="voter__pole">{state?.leftLabel ?? DEFAULT_LEFT_LABEL}</span>
          <span className="voter__pole voter__pole--right">
            {state?.rightLabel ?? DEFAULT_RIGHT_LABEL}
          </span>
        </div>
        <input
          className="slider"
          type="range"
          min={VALUE_MIN}
          max={VALUE_MAX}
          step={VALUE_STEP}
          value={value}
          aria-label={state?.question ?? 'Wert wählen'}
          onChange={(event) => setValue(Number.parseInt(event.target.value, 10))}
        />
      </div>

      <button
        type="button"
        className="button button--primary button--huge"
        onClick={submit}
        disabled={submitting || status !== 'open'}
      >
        {submitting ? 'Sende …' : editing ? 'Antwort aktualisieren' : 'Absenden'}
      </button>

      {editing ? (
        <p className="voter__hint" aria-live="polite">
          Noch {formatCountdown(remainingMs)} änderbar.
        </p>
      ) : null}

      {error ? <p className="voter__error">{error}</p> : null}
      {status !== 'open' ? <p className="voter__status">Verbindung wird wiederhergestellt …</p> : null}
    </main>
  );
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

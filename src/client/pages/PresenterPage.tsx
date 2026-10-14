import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_LEFT_LABEL,
  DEFAULT_RIGHT_LABEL,
  POLE_LABEL_MAX_LENGTH,
  QUESTION_MAX_LENGTH,
  type PresenterSessionState,
  type ServerMessage,
} from '../../shared/protocol.js';
import { DEFAULT_THEME, LEGACY_DEFAULT_THEME, parseTheme, sameColors, type Theme } from '../../shared/theme.js';
import { ConnectionBadge } from '../components/ConnectionBadge.js';
import { Logo } from '../components/Logo.js';
import { ThemeEditor } from '../components/ThemeEditor.js';
import { presenterThemeStyle } from '../lib/themeStyle.js';
import { DistributionChart } from '../components/DistributionChart.js';
import { QrCode } from '../components/QrCode.js';
import { fetchPublicOrigin, voteUrlFor } from '../lib/publicUrl.js';
import { usePollSocket, type SendMessage } from '../lib/usePollSocket.js';

const QUESTION_STORAGE_KEY = 'live-poll:last-question';
const LEFT_LABEL_STORAGE_KEY = 'live-poll:last-left-label';
const RIGHT_LABEL_STORAGE_KEY = 'live-poll:last-right-label';
const THEME_STORAGE_KEY = 'live-poll:last-theme';

function readStoredTheme(): Theme {
  try {
    const stored = parseTheme(JSON.parse(readStored(THEME_STORAGE_KEY, 'null')));
    if (!stored) return { ...DEFAULT_THEME };
    // Alte Standardfarben nicht festhalten, sondern auf das EnBW-CI umstellen.
    if (sameColors(stored, LEGACY_DEFAULT_THEME)) {
      return { ...DEFAULT_THEME, ...(stored.logo ? { logo: stored.logo } : {}) };
    }
    return stored;
  } catch {
    return { ...DEFAULT_THEME };
  }
}

export function PresenterPage(): JSX.Element {
  const [state, setState] = useState<PresenterSessionState | null>(null);
  const [question, setQuestion] = useState<string>(() =>
    readStored(QUESTION_STORAGE_KEY, 'Entwickeln oder Customizen?'),
  );
  const [leftLabel, setLeftLabel] = useState<string>(() =>
    readStored(LEFT_LABEL_STORAGE_KEY, DEFAULT_LEFT_LABEL),
  );
  const [rightLabel, setRightLabel] = useState<string>(() =>
    readStored(RIGHT_LABEL_STORAGE_KEY, DEFAULT_RIGHT_LABEL),
  );
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  const [origin, setOrigin] = useState<string>(() => window.location.origin);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchPublicOrigin(controller.signal)
      .then(setOrigin)
      .catch(() => setOrigin(window.location.origin));
    return () => controller.abort();
  }, []);

  const handleMessage = useCallback((message: ServerMessage) => {
    switch (message.type) {
      case 'presenter:state':
        setState(message.state);
        setError(null);
        break;
      case 'error':
        setError(message.message);
        break;
      case 'voter:state':
      case 'voter:accepted':
        break;
    }
  }, []);

  const handleOpen = useCallback(
    (send: SendMessage) => {
      // Nach einem Reconnect die bestehende Session erneut laden.
      if (state?.sessionId) send({ type: 'presenter:hello', sessionId: state.sessionId });
    },
    [state?.sessionId],
  );

  const { status, send } = usePollSocket(handleMessage, handleOpen);

  const voteUrl = useMemo(
    () => (state ? voteUrlFor(origin, state.sessionId) : ''),
    [origin, state],
  );

  const startSession = (): void => {
    persist(QUESTION_STORAGE_KEY, question);
    persist(LEFT_LABEL_STORAGE_KEY, leftLabel);
    persist(RIGHT_LABEL_STORAGE_KEY, rightLabel);
    persist(THEME_STORAGE_KEY, JSON.stringify(theme));
    send({ type: 'presenter:new-session', question, leftLabel, rightLabel, theme });
    setStarted(true);
  };

  const newSession = (): void => {
    setState(null);
    setStarted(false);
  };

  if (!started || !state) {
    return (
      <main className="presenter presenter--setup" style={presenterThemeStyle(theme)}>
        <header className="presenter__topbar">
          <h1>Live-Umfrage</h1>
          <ConnectionBadge status={status} />
        </header>

        <section className="setup">
          <label className="setup__label" htmlFor="question">
            Frage
          </label>
          <textarea
            id="question"
            className="setup__input"
            value={question}
            maxLength={QUESTION_MAX_LENGTH}
            rows={3}
            placeholder="Wie sicher fühlst du dich beim Einsatz von KI?"
            onChange={(event) => setQuestion(event.target.value)}
          />
          <p className="setup__counter">
            {question.length} / {QUESTION_MAX_LENGTH}
          </p>

          <p className="setup__label">Slider-Pole</p>
          <div className="setup__poles">
            <label className="setup__pole">
              <span>Links (0)</span>
              <input
                className="setup__input setup__input--small"
                value={leftLabel}
                maxLength={POLE_LABEL_MAX_LENGTH}
                placeholder={DEFAULT_LEFT_LABEL}
                onChange={(event) => setLeftLabel(event.target.value)}
              />
            </label>
            <label className="setup__pole">
              <span>Rechts (100)</span>
              <input
                className="setup__input setup__input--small"
                value={rightLabel}
                maxLength={POLE_LABEL_MAX_LENGTH}
                placeholder={DEFAULT_RIGHT_LABEL}
                onChange={(event) => setRightLabel(event.target.value)}
              />
            </label>
          </div>

          <p className="setup__label">Farbschema (CI)</p>
          <ThemeEditor theme={theme} onChange={setTheme} />

          <button
            type="button"
            className="button button--primary button--large"
            onClick={startSession}
            disabled={status !== 'open' || question.trim().length === 0}
          >
            Neue Umfrage starten
          </button>
          {error ? <p className="presenter__error">{error}</p> : null}
        </section>
      </main>
    );
  }

  const stats = state.stats;

  return (
    <main className="presenter" style={presenterThemeStyle(state.theme)}>
      <header className="presenter__header">
        <Logo theme={state.theme} className="logo--presenter" />
        <h1 className="presenter__question">{state.question}</h1>
        <div className="presenter__count">
          <strong>{stats.count}</strong>
          <span>{stats.count === 1 ? 'Antwort' : 'Antworten'}</span>
        </div>
      </header>

      <section className="presenter__body">
        <div className="presenter__chart">
          {state.resultsVisible ? (
            <DistributionChart
              stats={stats}
              leftLabel={state.leftLabel}
              rightLabel={state.rightLabel}
            />
          ) : (
            <div className="chart chart--empty">
              <p>Ergebnisse ausgeblendet</p>
              <span>{stats.count} Antworten eingegangen</span>
            </div>
          )}

          <dl className="metrics">
            <div className="metric">
              <dt>Antworten</dt>
              <dd>{stats.count}</dd>
            </div>
            <div className="metric">
              <dt>Durchschnitt</dt>
              <dd>{state.resultsVisible ? formatNumber(stats.average) : '–'}</dd>
            </div>
            <div className="metric">
              <dt>Median</dt>
              <dd>{state.resultsVisible ? formatNumber(stats.median) : '–'}</dd>
            </div>
          </dl>
        </div>

        <aside className="presenter__aside">
          <QrCode value={voteUrl} size={420} />
          <p className="presenter__url">{voteUrl}</p>
          <p className="presenter__code">Code: {state.sessionId}</p>
        </aside>
      </section>

      <footer className="presenter__footer">
        <ConnectionBadge status={status} />
        <div className="presenter__actions">
          <button
            type="button"
            className="button"
            onClick={() =>
              send({
                type: 'presenter:set-results-visible',
                sessionId: state.sessionId,
                visible: !state.resultsVisible,
              })
            }
          >
            {state.resultsVisible ? 'Ergebnisse ausblenden' : 'Ergebnisse anzeigen'}
          </button>
          <button
            type="button"
            className="button"
            onClick={() => send({ type: 'presenter:clear-responses', sessionId: state.sessionId })}
          >
            Antworten löschen
          </button>
          <button
            type="button"
            className="button"
            onClick={() => send({ type: 'presenter:reset-session', sessionId: state.sessionId })}
          >
            Umfrage zurücksetzen
          </button>
          <button type="button" className="button button--primary" onClick={newSession}>
            Neue Umfrage
          </button>
        </div>
        {error ? <p className="presenter__error">{error}</p> : null}
      </footer>
    </main>
  );
}

function formatNumber(value: number | null): string {
  if (value === null) return '–';
  return value.toLocaleString('de-DE', { maximumFractionDigits: 1 });
}

function readStored(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function persist(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage nicht verfügbar – unkritisch.
  }
}

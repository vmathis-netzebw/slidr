import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  alignResponses,
  responsesToCsv,
  summarize,
  type FeedbackAdminView,
  type QuestionSummary,
} from '../../shared/feedback.js';
import { DistributionChart } from '../components/DistributionChart.js';
import { QrCode } from '../components/QrCode.js';
import { downloadDefinition, downloadText, slugify } from '../lib/definitionFile.js';
import { ApiError, feedbackApi, feedbackUrlFor } from '../lib/feedbackApi.js';
import { fetchPublicOrigin } from '../lib/publicUrl.js';
import { themeStyle } from '../lib/themeStyle.js';
import { FeedbackCreatePage } from './FeedbackCreatePage.js';

export function FeedbackResultsPage({ feedbackId }: { feedbackId: string }): JSX.Element {
  // Passwort bleibt nur im Speicher dieser Seite.
  const [password, setPassword] = useState('');
  const [view, setView] = useState<FeedbackAdminView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [origin, setOrigin] = useState(() => window.location.origin);
  const [editing, setEditing] = useState(false);
  /** null = aktuelle Fragen mit allen kompatiblen Antworten; Zahl = nur diese Version. */
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchPublicOrigin(controller.signal).then(setOrigin).catch(() => undefined);
    return () => controller.abort();
  }, []);

  const evaluation = useMemo(() => {
    if (!view) return null;
    const picked = selectedVersion === null ? undefined : view.versions.find((v) => v.version === selectedVersion);
    if (picked) {
      const responses = view.responses.filter((r) => r.version === picked.version);
      return { definition: picked.definition, responses };
    }
    return { definition: view.definition, responses: alignResponses(view.versions, view.definition, view.responses) };
  }, [view, selectedVersion]);
  const summaries = useMemo(
    () => (evaluation ? summarize(evaluation.definition, evaluation.responses) : []),
    [evaluation],
  );

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Server nicht erreichbar.');
    } finally {
      setBusy(false);
    }
  };

  const load = (): Promise<void> => run(async () => setView(await feedbackApi.admin(feedbackId, password)));

  const onLogin = (event: FormEvent): void => {
    event.preventDefault();
    void load();
  };

  if (deleted) {
    return (
      <main className="voter voter--message">
        <h1>Feedback-Bogen gelöscht</h1>
        <a className="button" href="/feedback/new">
          Neuen Bogen erstellen
        </a>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="voter voter--message">
        <form className="login" onSubmit={onLogin}>
          <h1>Ergebnisse ansehen</h1>
          <label className="field">
            <span>Passwort</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error ? <p className="notice notice--error">{error}</p> : null}
          <button type="submit" className="button button--primary" disabled={busy || !password}>
            Entsperren
          </button>
        </form>
      </main>
    );
  }

  if (editing) {
    return (
      <FeedbackCreatePage
        edit={{
          id: view.id,
          password,
          definition: view.definition,
          hasResponses: view.responses.length > 0,
          onCancel: () => setEditing(false),
          onSaved: () => {
            setEditing(false);
            setSelectedVersion(null);
            void load();
          },
        }}
      />
    );
  }

  const { definition } = view;
  const evaluated = evaluation ?? { definition, responses: view.responses };
  const respondUrl = feedbackUrlFor(origin, view.id);
  const fileBase = `${slugify(definition.title)}-antworten`;

  return (
    <main className="page" style={themeStyle(definition.theme)}>
      <header className="page__header">
        <div>
          <h1>{definition.title}</h1>
          <p className="page__lead">
            <strong>{view.responses.length}</strong> Antworten · erstellt am {new Date(view.createdAt).toLocaleDateString('de-DE')}
            {view.closed ? ' · geschlossen' : ''}
            {view.versions.length > 1 ? ` · Version ${view.version}` : ''}
          </p>
        </div>
        <div className="row">
          <button type="button" className="button" disabled={busy} onClick={() => setEditing(true)}>
            Fragen bearbeiten
          </button>
          <button type="button" className="button" disabled={busy} onClick={() => void load()}>
            Aktualisieren
          </button>
        </div>
      </header>

      {error ? <p className="notice notice--error">{error}</p> : null}

      <section className="card created">
        <QrCode value={respondUrl} size={180} />
        <div className="created__links">
          <a href={respondUrl}>{respondUrl}</a>
          <div className="row">
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await feedbackApi.setClosed(view.id, password, !view.closed);
                  setView({ ...view, closed: !view.closed });
                })
              }
            >
              {view.closed ? 'Wieder öffnen' : 'Schließen (keine Antworten mehr)'}
            </button>
            <button
              type="button"
              className="button"
              onClick={() =>
                downloadText(
                  `${fileBase}.csv`,
                  `\uFEFF${responsesToCsv(evaluated.definition, evaluated.responses)}`,
                  'text/csv',
                )
              }
            >
              Antworten als CSV
            </button>
            <button
              type="button"
              className="button"
              onClick={() =>
                downloadText(
                  `${fileBase}.json`,
                  JSON.stringify({ versions: view.versions, responses: view.responses }, null, 2),
                  'application/json',
                )
              }
            >
              Antworten als JSON
            </button>
            <button type="button" className="button" onClick={() => downloadDefinition(definition, 'json')}>
              Fragen als JSON
            </button>
            <button type="button" className="button" onClick={() => downloadDefinition(definition, 'yaml')}>
              Fragen als YAML
            </button>
            <button
              type="button"
              className="button button--danger"
              disabled={busy}
              onClick={() => {
                if (!window.confirm('Bogen und alle Antworten endgültig löschen?')) return;
                void run(async () => {
                  await feedbackApi.remove(view.id, password);
                  setDeleted(true);
                });
              }}
            >
              Löschen
            </button>
          </div>
        </div>
      </section>

      {view.versions.length > 1 ? (
        <section className="card">
          <label className="field">
            <span>Auswertung</span>
            <select
              className="input"
              value={selectedVersion ?? ''}
              onChange={(e) => setSelectedVersion(e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">Aktuelle Fragen – alle passenden Antworten</option>
              {view.versions.map((v) => (
                <option key={v.version} value={v.version}>
                  Version {v.version} vom {new Date(v.createdAt).toLocaleString('de-DE')} –{' '}
                  {view.responses.filter((r) => r.version === v.version).length} Antworten
                </option>
              ))}
            </select>
          </label>
          <p className="field__hint">
            Antworten aus älteren Versionen zählen nur für Fragen, deren Typ und Optionen unverändert sind.
          </p>
        </section>
      ) : null}

      {summaries.map((summary, index) => (
        <section key={summary.question.id} className="card">
          <h2 className="question__title">
            {index + 1}. {summary.question.title}
          </h2>
          <p className="field__hint">
            {summary.answered} von {evaluated.responses.length} beantwortet
          </p>
          <SummaryView summary={summary} />
        </section>
      ))}
    </main>
  );
}

function SummaryView({ summary }: { summary: QuestionSummary }): JSX.Element {
  switch (summary.type) {
    case 'text':
      return summary.texts.length === 0 ? (
        <p className="field__hint">Noch keine Antworten.</p>
      ) : (
        <ul className="texts">
          {summary.texts.map((text, i) => (
            <li key={i} className="page__pre">
              {text}
            </li>
          ))}
        </ul>
      );

    case 'single':
    case 'multi':
      return <Bars labels={summary.question.options} counts={summary.counts} total={summary.answered} />;

    case 'scale': {
      const { question } = summary;
      const labels = summary.counts.map((_, i) => {
        const step = question.min + i;
        if (step === question.min && question.minLabel) return `${step} – ${question.minLabel}`;
        if (step === question.max && question.maxLabel) return `${step} – ${question.maxLabel}`;
        return String(step);
      });
      return (
        <>
          <p className="result-average">
            Durchschnitt: <strong>{summary.average === null ? '–' : summary.average.toLocaleString('de-DE', { maximumFractionDigits: 2 })}</strong>
          </p>
          <Bars labels={labels} counts={summary.counts} total={summary.answered} />
        </>
      );
    }

    case 'slider':
      return (
        <div className="result-chart">
          <DistributionChart
            stats={summary.stats}
            leftLabel={summary.question.leftLabel}
            rightLabel={summary.question.rightLabel}
          />
          <p className="result-average">
            Durchschnitt: <strong>{summary.stats.average === null ? '–' : Math.round(summary.stats.average)}</strong> · Median:{' '}
            <strong>{summary.stats.median === null ? '–' : Math.round(summary.stats.median)}</strong>
          </p>
        </div>
      );
  }
}

function Bars({ labels, counts, total }: { labels: string[]; counts: number[]; total: number }): JSX.Element {
  return (
    <ul className="bars">
      {labels.map((label, i) => {
        const count = counts[i] ?? 0;
        const percent = total > 0 ? Math.round((count / total) * 100) : 0;
        return (
          <li key={i} className="bars__row">
            <span className="bars__label">{label}</span>
            <span className="bars__track">
              <span className="bars__fill" style={{ width: `${percent}%` }} />
            </span>
            <span className="bars__value">
              {count} ({percent}%)
            </span>
          </li>
        );
      })}
    </ul>
  );
}

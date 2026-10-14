import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  FEEDBACK_ID_PATTERN,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  parseDefinition,
} from '../shared/feedback.js';
import { FeedbackStore } from './feedbackStore.js';
import { RateLimiter } from './rateLimiter.js';
import { isValidResponseId } from './validation.js';

const MAX_BODY_BYTES = 256 * 1024;

export interface FeedbackApiOptions {
  clientKeyFor: (req: IncomingMessage) => string;
  now?: () => number;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: string[],
  ) {
    super(message);
  }
}

/**
 * REST-API für Feedback-Bögen unter /api/feedback.
 *
 * POST /api/feedback                      { definition, password } -> { id }
 * GET  /api/feedback/:id                  öffentliche Definition
 * POST /api/feedback/:id/responses        { responseId, version, answers } (anlegen oder ändern)
 * POST /api/feedback/:id/responses/mine   { responseId } -> eigene Antwort
 * POST /api/feedback/:id/admin            { password } -> Definition + Versionen + Antworten
 * POST /api/feedback/:id/admin/definition { password, definition } -> neue Version
 * POST /api/feedback/:id/admin/settings   { password, closed }
 * POST /api/feedback/:id/admin/delete     { password }
 */
export class FeedbackApi {
  private readonly createLimiter: RateLimiter;
  private readonly submitLimiter: RateLimiter;
  private readonly authLimiter: RateLimiter;

  constructor(
    private readonly store: FeedbackStore,
    private readonly options: FeedbackApiOptions,
  ) {
    const now = options.now ?? Date.now;
    this.createLimiter = new RateLimiter(10, 10 / 3600, now);
    // Großzügig, weil viele Teilnehmende hinter einem NAT dieselbe IP teilen.
    this.submitLimiter = new RateLimiter(60, 2, now);
    this.authLimiter = new RateLimiter(10, 1 / 6, now);
  }

  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    try {
      await this.route(req, res, url);
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message, ...(error.details ? { details: error.details } : {}) });
        return;
      }
      throw error;
    }
  }

  private async route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    const parts = url.pathname.split('/').filter(Boolean).slice(2);
    const [id, ...rest] = parts;
    const action = rest.join('/');
    const clientKey = this.options.clientKeyFor(req);

    if (id === undefined) {
      expectMethod(req, 'POST');
      if (!this.createLimiter.tryConsume(clientKey)) throw new HttpError(429, 'Zu viele neue Bögen. Bitte später erneut.');
      const body = await readJsonBody(req);
      const definition = parseDefinition(body.definition);
      if (!definition.ok) throw new HttpError(400, 'Ungültige Definition.', definition.errors);
      const password = readPassword(body);
      const created = await this.store.create(definition.value, password);
      sendJson(res, 201, created);
      return;
    }

    if (!FEEDBACK_ID_PATTERN.test(id)) throw new HttpError(404, 'Feedback-Bogen nicht gefunden.');

    switch (action) {
      case '': {
        expectMethod(req, 'GET');
        const feedback = this.store.getPublic(id);
        if (!feedback) throw new HttpError(404, 'Feedback-Bogen nicht gefunden.');
        sendJson(res, 200, feedback);
        return;
      }

      case 'responses': {
        expectMethod(req, 'POST');
        if (!this.submitLimiter.tryConsume(clientKey)) throw new HttpError(429, 'Zu viele Anfragen. Bitte kurz warten.');
        const body = await readJsonBody(req);
        if (!isValidResponseId(body.responseId)) throw new HttpError(400, 'Ungültige Antwort-ID.');
        const result = this.store.submit(id, body.responseId, body.version, body.answers);
        if (result.ok) {
          sendJson(res, result.updated ? 200 : 201, result);
          return;
        }
        switch (result.reason) {
          case 'not-found':
            throw new HttpError(404, 'Feedback-Bogen nicht gefunden.');
          case 'closed':
            throw new HttpError(410, 'Dieser Feedback-Bogen nimmt keine Antworten mehr an.');
          case 'full':
            throw new HttpError(410, 'Dieser Feedback-Bogen nimmt keine weiteren Antworten an.');
          case 'outdated':
            throw new HttpError(409, 'Die Fragen wurden inzwischen geändert. Bitte Seite neu laden.');
          case 'invalid':
            throw new HttpError(400, 'Antworten unvollständig oder ungültig.', result.errors);
        }
        return;
      }

      case 'responses/mine': {
        expectMethod(req, 'POST');
        if (!this.submitLimiter.tryConsume(clientKey)) throw new HttpError(429, 'Zu viele Anfragen. Bitte kurz warten.');
        const body = await readJsonBody(req);
        if (!isValidResponseId(body.responseId)) throw new HttpError(400, 'Ungültige Antwort-ID.');
        sendJson(res, 200, this.store.getOwnResponse(id, body.responseId) ?? null);
        return;
      }

      case 'admin':
      case 'admin/definition':
      case 'admin/settings':
      case 'admin/delete': {
        expectMethod(req, 'POST');
        if (!this.authLimiter.tryConsume(`${clientKey}:${id}`)) {
          throw new HttpError(429, 'Zu viele Versuche. Bitte eine Minute warten.');
        }
        const body = await readJsonBody(req);
        const password = typeof body.password === 'string' ? body.password.slice(0, PASSWORD_MAX_LENGTH) : '';

        if (action === 'admin') {
          const view = await this.store.getAdminView(id, password);
          if (!view) throw unauthorized();
          sendJson(res, 200, view);
          return;
        }
        if (action === 'admin/definition') {
          const result = await this.store.update(id, password, body.definition);
          if (!result.ok) {
            if (result.reason === 'unauthorized') throw unauthorized();
            throw new HttpError(400, 'Ungültige Definition.', result.errors);
          }
          sendJson(res, 200, result.feedback);
          return;
        }
        if (action === 'admin/settings') {
          if (typeof body.closed !== 'boolean') throw new HttpError(400, '"closed" fehlt.');
          if (!(await this.store.setClosed(id, password, body.closed))) throw unauthorized();
          sendJson(res, 200, { ok: true });
          return;
        }
        if (!(await this.store.delete(id, password))) throw unauthorized();
        sendJson(res, 200, { ok: true });
        return;
      }

      default:
        throw new HttpError(404, 'Nicht gefunden.');
    }
  }
}

function unauthorized(): HttpError {
  // Bewusst gleiche Antwort für "unbekannt" und "falsches Passwort".
  return new HttpError(401, 'Bogen nicht gefunden oder Passwort falsch.');
}

function readPassword(body: Record<string, unknown>): string {
  const password = body.password;
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new HttpError(400, `Das Passwort muss mindestens ${PASSWORD_MIN_LENGTH} Zeichen lang sein.`);
  }
  return password;
}

function expectMethod(req: IncomingMessage, method: 'GET' | 'POST'): void {
  if (req.method !== method) throw new HttpError(405, 'Methode nicht erlaubt.');
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  // Nur application/json: einfache Cross-Site-Formulare können diesen Typ nicht ohne CORS-Preflight senden.
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Content-Type muss application/json sein.');
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Anfrage zu groß.');
    chunks.push(buffer);
  }

  let data: unknown;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Ungültiges JSON.');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new HttpError(400, 'Ungültiges JSON.');
  return data as Record<string, unknown>;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

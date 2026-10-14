import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseDefinition, type FeedbackDefinition } from '../shared/feedback.js';
import { FeedbackApi } from './feedbackApi.js';
import { FeedbackStore } from './feedbackStore.js';

const RESPONSE_ID = 'a'.repeat(32);
const PASSWORD = 'geheim123';

function definition(): FeedbackDefinition {
  const result = parseDefinition({
    title: 'Test',
    questions: [
      { type: 'scale', title: 'Note', required: true },
      { type: 'text', title: 'Kommentar' },
    ],
  });
  if (!result.ok) throw new Error('ungültig');
  return result.value;
}

describe('FeedbackStore', () => {
  let dir: string;
  let dbPath: string;
  const opened: FeedbackStore[] = [];
  const open = (path = dbPath) => {
    const store = new FeedbackStore(path);
    opened.push(store);
    return store;
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'feedback-'));
    dbPath = join(dir, 'feedback.sqlite');
  });

  afterEach(async () => {
    opened.splice(0).forEach((store) => store.close());
    await rm(dir, { recursive: true, force: true });
  });

  it('überlebt einen Neustart mit Definition, Status und Antworten', async () => {
    const store = open();
    const { id } = await store.create(definition(), PASSWORD);
    expect(store.submit(id, RESPONSE_ID, 1, { q1: 4, q2: 'gut' })).toEqual({ ok: true, updated: false });
    expect(await store.setClosed(id, PASSWORD, true)).toBe(true);
    store.close();

    const restarted = open();
    const view = await restarted.getAdminView(id, PASSWORD);
    expect(view?.closed).toBe(true);
    expect(view?.responses.map((r) => r.answers)).toEqual([{ q1: 4, q2: 'gut' }]);
  });

  it('schützt Ergebnisse per Passwort und speichert nur den Hash', async () => {
    const store = open();
    const { id } = await store.create(definition(), PASSWORD);
    expect(await store.getAdminView(id, 'falsch!!')).toBeUndefined();
    expect(await store.setClosed(id, 'falsch!!', true)).toBe(false);
    expect(await store.delete(id, 'falsch!!')).toBe(false);
    expect(JSON.stringify(store.getPublic(id))).not.toContain('scrypt');

    const raw = new DatabaseSync(dbPath, { readOnly: true });
    const row = raw.prepare('SELECT * FROM feedbacks WHERE id = ?').get(id);
    raw.close();
    expect(JSON.stringify(row)).not.toContain(PASSWORD);
    expect(row?.password_hash).toMatch(/^scrypt\$/);
  });

  it('hält eine änderbare Antwort pro Gerät und lehnt ungültige/geschlossene ab', async () => {
    const store = open(':memory:');
    const { id } = await store.create(definition(), PASSWORD);
    expect(store.submit(id, RESPONSE_ID, 1, { q2: 'ohne Pflicht' })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(store.submit(id, RESPONSE_ID, 1, { q1: 3 })).toEqual({ ok: true, updated: false });
    expect(store.submit(id, RESPONSE_ID, 1, { q1: 5 })).toEqual({ ok: true, updated: true });
    expect(store.getOwnResponse(id, RESPONSE_ID)).toEqual({ version: 1, answers: { q1: 5 } });
    expect(store.getOwnResponse(id, 'b'.repeat(32))).toBeUndefined();
    const view = await store.getAdminView(id, PASSWORD);
    expect(view?.responses).toHaveLength(1);
    expect(view?.responses[0]?.updatedAt).toBeTypeOf('number');
    await store.setClosed(id, PASSWORD, true);
    expect(store.submit(id, 'b'.repeat(32), 1, { q1: 3 })).toMatchObject({ reason: 'closed' });
    expect(store.submit(id, RESPONSE_ID, 1, { q1: 3 })).toMatchObject({ reason: 'closed' });
  });

  it('versioniert geänderte Fragen', async () => {
    const store = open(':memory:');
    const { id } = await store.create(definition(), PASSWORD);
    store.submit(id, RESPONSE_ID, 1, { q1: 4 });

    expect(await store.update(id, 'falsch!!', definition())).toEqual({ ok: false, reason: 'unauthorized' });
    expect(await store.update(id, PASSWORD, { title: '' })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await store.update(id, PASSWORD, definition())).toMatchObject({ ok: true, feedback: { version: 1 } });

    const changed = { title: 'Neu', questions: [{ id: 'q1', type: 'scale', title: 'Note' }, { type: 'text', title: 'Neu' }] };
    const result = await store.update(id, PASSWORD, changed);
    expect(result).toMatchObject({ ok: true, feedback: { version: 2 } });
    // q2 existierte in Version 1 -> neue Frage bekommt q3
    expect(result.ok && result.feedback.definition.questions.map((q) => q.id)).toEqual(['q1', 'q3']);

    expect(store.submit(id, 'b'.repeat(32), 1, { q1: 2 })).toMatchObject({ reason: 'outdated' });
    expect(store.submit(id, 'b'.repeat(32), 2, { q1: 2, q3: 'x' })).toEqual({ ok: true, updated: false });

    const view = await store.getAdminView(id, PASSWORD);
    expect(view?.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(view?.responses.map((r) => r.version)).toEqual([1, 2]);
    expect(store.getPublic(id)?.definition.title).toBe('Neu');
  });

  it('löscht Bogen samt Antworten', async () => {
    const store = open();
    const { id } = await store.create(definition(), PASSWORD);
    store.submit(id, RESPONSE_ID, 1, { q1: 1 });
    expect(await store.delete(id, PASSWORD)).toBe(true);
    expect(store.size).toBe(0);

    const raw = new DatabaseSync(dbPath, { readOnly: true });
    const { n } = raw.prepare('SELECT count(*) AS n FROM responses').get() as { n: number };
    raw.close();
    expect(n).toBe(0);
  });

  it('begrenzt die Anzahl Antworten', async () => {
    const store = new FeedbackStore(':memory:', 1);
    opened.push(store);
    const { id } = await store.create(definition(), PASSWORD);
    expect(store.submit(id, RESPONSE_ID, 1, { q1: 1 })).toEqual({ ok: true, updated: false });
    expect(store.submit(id, 'b'.repeat(32), 1, { q1: 2 })).toMatchObject({ reason: 'full' });
    expect(store.submit(id, RESPONSE_ID, 1, { q1: 2 })).toEqual({ ok: true, updated: true });
  });

  it('teilt Daten zwischen zwei Verbindungen auf dieselbe Datei', async () => {
    const a = open();
    const b = open();
    const { id } = await a.create(definition(), PASSWORD);
    expect(b.submit(id, RESPONSE_ID, 1, { q1: 5 })).toEqual({ ok: true, updated: false });
    expect(a.submit(id, RESPONSE_ID, 1, { q1: 4 })).toEqual({ ok: true, updated: true });
    expect((await a.getAdminView(id, PASSWORD))?.responses).toHaveLength(1);
  });
});

describe('FeedbackApi', () => {
  let server: Server;
  let base: string;

  beforeEach(async () => {
    const api = new FeedbackApi(new FeedbackStore(':memory:'), { clientKeyFor: () => 'test' });
    server = createServer((req, res) => {
      void api.handle(req, res, new URL(req.url ?? '/', 'http://localhost'));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/feedback`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const post = (path: string, body: unknown, contentType = 'application/json'): Promise<Response> =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': contentType }, body: JSON.stringify(body) });

  it('durchläuft Erstellen, Antworten und Auswerten', async () => {
    const created = await post('', { definition: definition(), password: PASSWORD });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const publicView = (await (await fetch(`${base}/${id}`)).json()) as Record<string, unknown>;
    expect(publicView).not.toHaveProperty('responses');
    expect(publicView).not.toHaveProperty('passwordHash');

    const answer = (q1: number, version = 1) => post(`/${id}/responses`, { responseId: RESPONSE_ID, version, answers: { q1 } });
    expect((await answer(5)).status).toBe(201);
    expect((await answer(4)).status).toBe(200);
    expect((await answer(4, 7)).status).toBe(409);
    expect(await (await post(`/${id}/responses/mine`, { responseId: RESPONSE_ID })).json()).toEqual({ version: 1, answers: { q1: 4 } });
    expect(await (await post(`/${id}/responses/mine`, { responseId: 'c'.repeat(32) })).json()).toBeNull();

    expect((await post(`/${id}/admin/definition`, { password: 'falsch!!', definition: definition() })).status).toBe(401);
    const updated = await post(`/${id}/admin/definition`, { password: PASSWORD, definition: { ...definition(), title: 'Neu' } });
    expect(await updated.json()).toMatchObject({ version: 2 });
    expect((await post(`/${id}/admin`, { password: 'falsch!!' })).status).toBe(401);

    const admin = await post(`/${id}/admin`, { password: PASSWORD });
    expect(admin.status).toBe(200);
    expect(((await admin.json()) as { responses: unknown[] }).responses).toHaveLength(1);
  });

  it('validiert Eingaben', async () => {
    expect((await post('', { definition: definition(), password: 'kurz' })).status).toBe(400);
    expect((await post('', { definition: { title: 'x', questions: [] }, password: PASSWORD })).status).toBe(400);
    expect((await post('', { definition: definition(), password: PASSWORD }, 'text/plain')).status).toBe(415);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  it('bremst Passwort-Raten aus', async () => {
    const { id } = (await (await post('', { definition: definition(), password: PASSWORD })).json()) as { id: string };
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) statuses.push((await post(`/${id}/admin`, { password: 'falsch!!' })).status);
    expect(statuses).toContain(429);
  });
});

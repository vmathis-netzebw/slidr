import type {
  Answers,
  FeedbackAdminView,
  FeedbackDefinition,
  OwnResponse,
  PublicFeedback,
} from '../../shared/feedback.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: { method: 'POST'; body: unknown }): Promise<T> {
  const response = await fetch(
    path,
    init
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) }
      : undefined,
  );
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const record = (data ?? {}) as { error?: unknown; details?: unknown };
    throw new ApiError(
      response.status,
      typeof record.error === 'string' ? record.error : `Fehler ${response.status}`,
      Array.isArray(record.details) ? record.details.filter((d): d is string => typeof d === 'string') : [],
    );
  }
  return data as T;
}

const base = (id: string): string => `/api/feedback/${encodeURIComponent(id)}`;

export const feedbackApi = {
  create: (definition: FeedbackDefinition, password: string) =>
    request<PublicFeedback>('/api/feedback', { method: 'POST', body: { definition, password } }),
  get: (id: string) => request<PublicFeedback>(base(id)),
  submit: (id: string, responseId: string, version: number, answers: Answers) =>
    request<{ ok: true; updated: boolean }>(`${base(id)}/responses`, {
      method: 'POST',
      body: { responseId, version, answers },
    }),
  mine: (id: string, responseId: string) =>
    request<OwnResponse | null>(`${base(id)}/responses/mine`, { method: 'POST', body: { responseId } }),
  update: (id: string, password: string, definition: unknown) =>
    request<PublicFeedback>(`${base(id)}/admin/definition`, { method: 'POST', body: { password, definition } }),
  admin: (id: string, password: string) =>
    request<FeedbackAdminView>(`${base(id)}/admin`, { method: 'POST', body: { password } }),
  setClosed: (id: string, password: string, closed: boolean) =>
    request<{ ok: true }>(`${base(id)}/admin/settings`, { method: 'POST', body: { password, closed } }),
  remove: (id: string, password: string) =>
    request<{ ok: true }>(`${base(id)}/admin/delete`, { method: 'POST', body: { password } }),
};

export function feedbackUrlFor(origin: string, id: string): string {
  return `${origin.replace(/\/+$/, '')}/f/${id}`;
}

export function resultsUrlFor(origin: string, id: string): string {
  return `${feedbackUrlFor(origin, id)}/results`;
}

const STORAGE_PREFIX = 'live-poll:response-id:';

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Anonyme, pro Session eindeutige ID im localStorage.
 * Enthält keinerlei personenbezogene Daten und bleibt auf dem Gerät.
 */
export function getOrCreateResponseId(sessionId: string): string {
  const key = `${STORAGE_PREFIX}${sessionId}`;
  try {
    const existing = window.localStorage.getItem(key);
    if (existing && /^[a-z0-9]{16,64}$/.test(existing)) return existing;
    const created = randomId();
    window.localStorage.setItem(key, created);
    return created;
  } catch {
    // Privater Modus / Storage blockiert: ID nur für diese Seitensitzung.
    return randomId();
  }
}
